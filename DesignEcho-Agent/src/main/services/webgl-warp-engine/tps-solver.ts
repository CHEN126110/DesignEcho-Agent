/**
 * Thin Plate Spline (TPS) 求解器
 * 
 * TPS 是一种基于物理模型的插值方法，模拟薄金属板的变形
 * 适合用于图像变形，因为它产生平滑、自然的变形
 * 
 * 数学原理：
 * f(x,y) = a0 + a1*x + a2*y + Σ wi * U(|Pi - (x,y)|)
 * 其中 U(r) = r² * ln(r)（径向基函数）
 */

import { Point2D, TPSWeights, ControlPointPair } from './types';

/**
 * TPS 求解器
 */
export class TPSSolver {
    private controlPoints: Point2D[] = [];
    private weights: TPSWeights | null = null;
    
    /**
     * 计算 TPS 权重
     */
    solve(controlPairs: ControlPointPair[]): TPSWeights {
        const n = controlPairs.length;
        
        if (n < 3) {
            throw new Error('TPS 至少需要 3 个控制点');
        }
        
        // 提取源点和目标点
        const sourcePoints = controlPairs.map(p => p.source);
        const targetX = controlPairs.map(p => p.target.x);
        const targetY = controlPairs.map(p => p.target.y);
        
        this.controlPoints = sourcePoints;
        
        // 构建 TPS 矩阵 (n+3) x (n+3)
        // | K  P | | w |   | v |
        // | P' 0 | | a | = | 0 |
        // 
        // K(i,j) = U(|Pi - Pj|)
        // P = [1, x1, y1; 1, x2, y2; ...]
        
        const matrixSize = n + 3;
        const L: number[][] = Array(matrixSize).fill(null).map(() => Array(matrixSize).fill(0));
        
        // 填充 K 矩阵
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const r = this.distance(sourcePoints[i], sourcePoints[j]);
                const val = this.radialBasisFunction(r);
                L[i][j] = val;
                L[j][i] = val;
            }
            // 对角线为 0（正则化可以加小值）
            L[i][i] = 0;
        }
        
        // 填充 P 矩阵
        for (let i = 0; i < n; i++) {
            L[i][n] = 1;
            L[i][n + 1] = sourcePoints[i].x;
            L[i][n + 2] = sourcePoints[i].y;
            
            L[n][i] = 1;
            L[n + 1][i] = sourcePoints[i].x;
            L[n + 2][i] = sourcePoints[i].y;
        }
        
        // 右下角为 0
        for (let i = n; i < matrixSize; i++) {
            for (let j = n; j < matrixSize; j++) {
                L[i][j] = 0;
            }
        }
        
        // 构建右侧向量
        const bx: number[] = [...targetX, 0, 0, 0];
        const by: number[] = [...targetY, 0, 0, 0];
        
        // 求解线性方程组 L * w = b
        const wx = this.solveLinearSystem(L, bx);
        const wy = this.solveLinearSystem(L, by);
        
        if (!wx || !wy) {
            throw new Error('TPS 矩阵求解失败');
        }
        
        // 提取权重和仿射参数
        const weightsX = wx.slice(0, n);
        const weightsY = wy.slice(0, n);
        const affineX = wx.slice(n);
        const affineY = wy.slice(n);
        
        this.weights = {
            affine: [affineX, affineY],
            weights: [weightsX, weightsY],
            controlPoints: sourcePoints
        };
        
        return this.weights;
    }
    
    /**
     * 使用计算好的权重进行点变换
     */
    transform(point: Point2D, weights?: TPSWeights): Point2D {
        const w = weights || this.weights;
        if (!w) {
            throw new Error('请先调用 solve() 计算权重');
        }
        
        const { affine, weights: W, controlPoints } = w;
        const n = controlPoints.length;
        
        // 计算仿射部分
        let x = affine[0][0] + affine[0][1] * point.x + affine[0][2] * point.y;
        let y = affine[1][0] + affine[1][1] * point.x + affine[1][2] * point.y;
        
        // 计算 TPS 非线性部分
        for (let i = 0; i < n; i++) {
            const r = this.distance(point, controlPoints[i]);
            const u = this.radialBasisFunction(r);
            x += W[0][i] * u;
            y += W[1][i] * u;
        }
        
        return { x, y };
    }
    
    /**
     * 批量变换点
     */
    transformPoints(points: Point2D[], weights?: TPSWeights): Point2D[] {
        return points.map(p => this.transform(p, weights));
    }
    
    /**
     * 生成位移场
     */
    generateDisplacementField(
        width: number,
        height: number,
        gridSize: number = 10,
        weights?: TPSWeights
    ): { dx: Float32Array; dy: Float32Array; gridCols: number; gridRows: number } {
        const gridCols = Math.ceil(width / gridSize) + 1;
        const gridRows = Math.ceil(height / gridSize) + 1;
        const totalPoints = gridCols * gridRows;
        
        const dx = new Float32Array(totalPoints);
        const dy = new Float32Array(totalPoints);
        
        for (let row = 0; row < gridRows; row++) {
            for (let col = 0; col < gridCols; col++) {
                const x = Math.min(col * gridSize, width - 1);
                const y = Math.min(row * gridSize, height - 1);
                
                const transformed = this.transform({ x, y }, weights);
                
                const idx = row * gridCols + col;
                dx[idx] = transformed.x - x;
                dy[idx] = transformed.y - y;
            }
        }
        
        return { dx, dy, gridCols, gridRows };
    }
    
    /**
     * 欧几里得距离
     */
    private distance(p1: Point2D, p2: Point2D): number {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    /**
     * TPS 径向基函数 U(r) = r² * ln(r)
     */
    private radialBasisFunction(r: number): number {
        if (r < 1e-10) return 0;
        return r * r * Math.log(r);
    }
    
    /**
     * 求解线性方程组 (高斯消元法)
     */
    private solveLinearSystem(A: number[][], b: number[]): number[] | null {
        const n = A.length;
        
        // 创建增广矩阵的副本
        const augmented: number[][] = A.map((row, i) => [...row, b[i]]);
        
        // 前向消元
        for (let col = 0; col < n; col++) {
            // 找主元
            let maxRow = col;
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) {
                    maxRow = row;
                }
            }
            
            // 交换行
            [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];
            
            // 检查是否奇异
            if (Math.abs(augmented[col][col]) < 1e-10) {
                console.warn(`[TPS] 矩阵接近奇异，在第 ${col} 列`);
                // 添加正则化
                augmented[col][col] += 1e-6;
            }
            
            // 消元
            for (let row = col + 1; row < n; row++) {
                const factor = augmented[row][col] / augmented[col][col];
                for (let j = col; j <= n; j++) {
                    augmented[row][j] -= factor * augmented[col][j];
                }
            }
        }
        
        // 回代
        const x = new Array(n).fill(0);
        for (let row = n - 1; row >= 0; row--) {
            let sum = augmented[row][n];
            for (let col = row + 1; col < n; col++) {
                sum -= augmented[row][col] * x[col];
            }
            x[row] = sum / augmented[row][row];
        }
        
        return x;
    }
}

export default TPSSolver;
