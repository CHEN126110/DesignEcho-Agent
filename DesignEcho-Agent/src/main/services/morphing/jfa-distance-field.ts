/**
 * JFA (Jump Flooding Algorithm) 距离场计算
 * 
 * 高效计算每个像素到轮廓的最近距离
 * 复杂度: O(n × log(max(w,h))) vs 暴力 O(n × 轮廓长度)
 * 
 * 参考论文: "Jump Flooding in GPU with Applications" (Rong & Tan, 2006)
 */

import { Point2D } from './types';

/**
 * JFA 距离场计算器
 */
export class JFADistanceField {
    /**
     * 计算距离场
     * @param width 图像宽度
     * @param height 图像高度
     * @param contour 轮廓点数组
     * @returns 距离场 (每个像素到最近轮廓点的距离)
     */
    compute(width: number, height: number, contour: Point2D[]): Float32Array {
        console.log(`[JFA] 开始计算距离场 ${width}×${height}, 轮廓点数: ${contour.length}`);
        const startTime = performance.now();
        
        // 1. 初始化种子点数组
        // seeds[i] = 最近种子点的索引 (y * width + x), -1 表示无种子
        const seeds = new Int32Array(width * height).fill(-1);
        
        // 2. 将轮廓点设为种子
        const seedSet = new Set<number>();
        for (const point of contour) {
            const x = Math.round(point.x);
            const y = Math.round(point.y);
            
            if (x >= 0 && x < width && y >= 0 && y < height) {
                const idx = y * width + x;
                seeds[idx] = idx;  // 自己是自己的最近种子
                seedSet.add(idx);
            }
        }
        
        console.log(`[JFA] 初始化种子点: ${seedSet.size}`);
        
        // 3. Jump Flooding 迭代
        // 步长从 max(w,h)/2 开始，每次减半
        let step = Math.max(width, height) >> 1;
        let iterations = 0;
        
        while (step >= 1) {
            this.floodStep(seeds, width, height, step);
            step >>= 1;
            iterations++;
        }
        
        // 4. 额外的 1+JFA 步骤提高精度
        // 再做一次 step=1 和 step=2 的传播
        this.floodStep(seeds, width, height, 2);
        this.floodStep(seeds, width, height, 1);
        
        console.log(`[JFA] 完成 ${iterations + 2} 次迭代`);
        
        // 5. 计算最终距离
        const distances = new Float32Array(width * height);
        
        for (let i = 0; i < seeds.length; i++) {
            const seedIdx = seeds[i];
            
            if (seedIdx === -1) {
                // 没有找到种子点 (理论上不应该发生)
                distances[i] = Infinity;
            } else {
                const px = i % width;
                const py = Math.floor(i / width);
                const sx = seedIdx % width;
                const sy = Math.floor(seedIdx / width);
                
                const dx = px - sx;
                const dy = py - sy;
                distances[i] = Math.sqrt(dx * dx + dy * dy);
            }
        }
        
        const duration = performance.now() - startTime;
        console.log(`[JFA] ✅ 距离场计算完成, 耗时 ${duration.toFixed(2)}ms`);
        
        return distances;
    }
    
    /**
     * JFA 单步传播
     * @param seeds 种子点数组
     * @param width 图像宽度
     * @param height 图像高度
     * @param step 步长
     */
    private floodStep(
        seeds: Int32Array,
        width: number,
        height: number,
        step: number
    ): void {
        // 8 个方向的偏移
        const offsets = [
            [-step, -step], [0, -step], [step, -step],
            [-step, 0],                  [step, 0],
            [-step, step],  [0, step],  [step, step]
        ];
        
        // 创建临时数组避免读写冲突
        const newSeeds = new Int32Array(seeds);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                let bestSeed = seeds[idx];
                let bestDistSq = this.getDistanceSquared(idx, bestSeed, width);
                
                // 检查 8 个邻居
                for (const [dx, dy] of offsets) {
                    const nx = x + dx;
                    const ny = y + dy;
                    
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                        continue;
                    }
                    
                    const neighborIdx = ny * width + nx;
                    const neighborSeed = seeds[neighborIdx];
                    
                    if (neighborSeed === -1) {
                        continue;
                    }
                    
                    // 计算当前点到邻居种子的距离
                    const distSq = this.getDistanceSquared(idx, neighborSeed, width);
                    
                    if (distSq < bestDistSq) {
                        bestDistSq = distSq;
                        bestSeed = neighborSeed;
                    }
                }
                
                newSeeds[idx] = bestSeed;
            }
        }
        
        // 复制回原数组
        seeds.set(newSeeds);
    }
    
    /**
     * 计算两个像素索引之间的距离平方
     */
    private getDistanceSquared(idx1: number, idx2: number, width: number): number {
        if (idx2 === -1) return Infinity;
        
        const x1 = idx1 % width;
        const y1 = Math.floor(idx1 / width);
        const x2 = idx2 % width;
        const y2 = Math.floor(idx2 / width);
        
        const dx = x1 - x2;
        const dy = y1 - y2;
        
        return dx * dx + dy * dy;
    }
    
    /**
     * 计算有符号距离场 (SDF)
     * 轮廓内部为负值，外部为正值
     */
    computeSDF(
        width: number,
        height: number,
        contour: Point2D[],
        isInside: Uint8Array  // 内部掩码
    ): Float32Array {
        const distances = this.compute(width, height, contour);
        
        // 应用符号
        for (let i = 0; i < distances.length; i++) {
            if (isInside[i]) {
                distances[i] = -distances[i];
            }
        }
        
        return distances;
    }
    
    /**
     * 生成边缘带权重图
     * @param distanceField 距离场
     * @param bandWidth 边缘带宽度
     * @param transitionWidth 过渡宽度 (权重从1渐变到0)
     * @returns 权重图 (0-1)
     */
    generateWeightMap(
        distanceField: Float32Array,
        bandWidth: number,
        transitionWidth: number
    ): Float32Array {
        const weights = new Float32Array(distanceField.length);
        const fullBand = bandWidth - transitionWidth;
        
        for (let i = 0; i < distanceField.length; i++) {
            const dist = distanceField[i];
            
            if (dist <= fullBand) {
                // 完全在边缘带内
                weights[i] = 1.0;
            } else if (dist < bandWidth) {
                // 过渡区
                const t = (dist - fullBand) / transitionWidth;
                // Hermite 平滑插值: 3t² - 2t³
                weights[i] = 1 - (t * t * (3 - 2 * t));
            } else {
                // 超出边缘带
                weights[i] = 0.0;
            }
        }
        
        return weights;
    }
    
    /**
     * 生成自适应边缘带权重
     * 位移越大，边缘带越宽
     */
    generateAdaptiveWeightMap(
        distanceField: Float32Array,
        displacementMagnitude: Float32Array,  // 每个轮廓点的位移大小
        width: number,
        height: number,
        baseWidth: number = 40,
        maxWidth: number = 120
    ): Float32Array {
        // 计算每个像素的自适应边缘带宽度
        const adaptiveWidths = new Float32Array(distanceField.length);
        
        // 简化: 使用平均位移大小
        let avgDisplacement = 0;
        for (const d of displacementMagnitude) {
            avgDisplacement += d;
        }
        avgDisplacement /= displacementMagnitude.length;
        
        // 根据平均位移调整边缘带宽度
        // 位移越大，边缘带越宽
        const bandWidth = Math.min(maxWidth, baseWidth + avgDisplacement * 0.5);
        const transitionWidth = bandWidth * 0.4;
        
        console.log(`[JFA] 自适应边缘带: 宽度=${bandWidth.toFixed(1)}px, 过渡=${transitionWidth.toFixed(1)}px`);
        
        return this.generateWeightMap(distanceField, bandWidth, transitionWidth);
    }
}

/**
 * 暴力算法距离场 (用于验证)
 */
export class BruteForceDistanceField {
    compute(width: number, height: number, contour: Point2D[]): Float32Array {
        console.log(`[BruteForce] 开始计算距离场 ${width}×${height}`);
        const startTime = performance.now();
        
        const distances = new Float32Array(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let minDist = Infinity;
                
                for (const point of contour) {
                    const dx = x - point.x;
                    const dy = y - point.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    if (dist < minDist) {
                        minDist = dist;
                    }
                }
                
                distances[y * width + x] = minDist;
            }
        }
        
        const duration = performance.now() - startTime;
        console.log(`[BruteForce] ✅ 完成, 耗时 ${duration.toFixed(2)}ms`);
        
        return distances;
    }
}

/**
 * 测试 JFA 精度
 */
export async function testJFAPrecision(
    width: number = 500,
    height: number = 500,
    contourPoints: number = 100
): Promise<{ maxError: number; avgError: number; speedup: number }> {
    // 生成测试轮廓 (椭圆)
    const contour: Point2D[] = [];
    const cx = width / 2;
    const cy = height / 2;
    const rx = width * 0.4;
    const ry = height * 0.3;
    
    for (let i = 0; i < contourPoints; i++) {
        const angle = (i / contourPoints) * Math.PI * 2;
        contour.push({
            x: cx + rx * Math.cos(angle),
            y: cy + ry * Math.sin(angle)
        });
    }
    
    // JFA 计算
    const jfa = new JFADistanceField();
    const jfaStart = performance.now();
    const jfaResult = jfa.compute(width, height, contour);
    const jfaDuration = performance.now() - jfaStart;
    
    // 暴力算法计算
    const brute = new BruteForceDistanceField();
    const bruteStart = performance.now();
    const bruteResult = brute.compute(width, height, contour);
    const bruteDuration = performance.now() - bruteStart;
    
    // 计算误差
    let maxError = 0;
    let totalError = 0;
    
    for (let i = 0; i < jfaResult.length; i++) {
        const error = Math.abs(jfaResult[i] - bruteResult[i]);
        totalError += error;
        if (error > maxError) {
            maxError = error;
        }
    }
    
    const avgError = totalError / jfaResult.length;
    const speedup = bruteDuration / jfaDuration;
    
    console.log(`[JFA Test] 图像: ${width}×${height}, 轮廓点: ${contourPoints}`);
    console.log(`[JFA Test] JFA 耗时: ${jfaDuration.toFixed(2)}ms`);
    console.log(`[JFA Test] 暴力算法耗时: ${bruteDuration.toFixed(2)}ms`);
    console.log(`[JFA Test] 加速比: ${speedup.toFixed(1)}x`);
    console.log(`[JFA Test] 最大误差: ${maxError.toFixed(3)}px`);
    console.log(`[JFA Test] 平均误差: ${avgError.toFixed(3)}px`);
    
    return { maxError, avgError, speedup };
}
