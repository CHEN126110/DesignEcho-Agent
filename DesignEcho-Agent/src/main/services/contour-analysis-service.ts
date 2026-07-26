/**
 * 轮廓分析服务
 * 
 * 分析源轮廓与目标轮廓的差异，生成变形控制点对
 */

export interface Point2D {
    x: number;
    y: number;
}

export interface ControlPointPair {
    source: Point2D;    // 源轮廓上的点
    target: Point2D;    // 目标轮廓上对应的点
    weight: number;     // 权重（0-1，用于控制变形强度）
    distance: number;   // 两点之间的距离
}

export interface ContourAnalysisResult {
    success: boolean;
    controlPoints?: ControlPointPair[];     // 控制点对
    shapeDifference?: number;               // 形状差异度 (0-1)
    averageDisplacement?: number;           // 平均位移量
    maxDisplacement?: number;               // 最大位移量
    boundingBoxRatio?: {                    // 边界框比例
        widthRatio: number;
        heightRatio: number;
    };
    error?: string;
    processingTime?: number;
}

export interface ContourData {
    points: Point2D[];
    boundingBox: { x: number; y: number; width: number; height: number };
    centroid: Point2D;
    area: number;
}

/**
 * 轮廓分析服务
 */
export class ContourAnalysisService {
    private static instance: ContourAnalysisService;
    
    static getInstance(): ContourAnalysisService {
        if (!ContourAnalysisService.instance) {
            ContourAnalysisService.instance = new ContourAnalysisService();
        }
        return ContourAnalysisService.instance;
    }
    
    /**
     * 分析两个轮廓的差异并生成控制点
     * @param sourceContour - 源轮廓（产品主体）
     * @param targetContour - 目标轮廓（参考形状）
     * @param options - 分析选项
     */
    analyzeContours(
        sourceContour: ContourData,
        targetContour: ContourData,
        options: {
            controlPointCount?: number;     // 控制点数量
            matchMethod?: 'ordered' | 'nearest' | 'dtw';  // 匹配方法
            weightByDistance?: boolean;     // 是否按距离加权
            edgeBandWidth?: number;         // 边缘带宽度（用于保护内容）
        } = {}
    ): ContourAnalysisResult {
        const startTime = Date.now();
        const controlPointCount = options.controlPointCount || 50;
        const matchMethod = options.matchMethod || 'ordered';
        
        console.log(`[ContourAnalysis] 开始分析轮廓`);
        console.log(`  源轮廓: ${sourceContour.points.length} 点`);
        console.log(`  目标轮廓: ${targetContour.points.length} 点`);
        console.log(`  控制点数量: ${controlPointCount}`);
        console.log(`  匹配方法: ${matchMethod}`);
        
        try {
            // 1. 采样到相同数量的点
            let sourceSampled = this.resampleContour(sourceContour.points, controlPointCount);
            let targetSampled = this.resampleContour(targetContour.points, controlPointCount);
            
            console.log(`  采样后: 源 ${sourceSampled.length} 点, 目标 ${targetSampled.length} 点`);
            
            // 1.5 归一化轮廓：对齐起始点和方向
            console.log(`  归一化轮廓: 对齐起始点和方向...`);
            sourceSampled = this.normalizeContourStartPoint(sourceSampled);
            targetSampled = this.normalizeContourStartPoint(targetSampled);
            
            // 确保两个轮廓方向一致（都是顺时针）
            if (this.isCounterClockwise(sourceSampled)) {
                console.log(`    源轮廓方向: 逆时针 -> 反转为顺时针`);
                sourceSampled = sourceSampled.reverse();
            }
            if (this.isCounterClockwise(targetSampled)) {
                console.log(`    目标轮廓方向: 逆时针 -> 反转为顺时针`);
                targetSampled = targetSampled.reverse();
            }
            
            // 2. 根据方法进行匹配
            let controlPoints: ControlPointPair[];
            
            switch (matchMethod) {
                case 'ordered':
                    controlPoints = this.matchOrdered(sourceSampled, targetSampled, options.weightByDistance);
                    break;
                case 'nearest':
                    controlPoints = this.matchNearest(sourceSampled, targetSampled, options.weightByDistance);
                    break;
                case 'dtw':
                    controlPoints = this.matchDTW(sourceSampled, targetSampled, options.weightByDistance);
                    break;
                default:
                    controlPoints = this.matchOrdered(sourceSampled, targetSampled, options.weightByDistance);
            }
            
            console.log(`  生成 ${controlPoints.length} 个控制点对`);
            
            // 3. 计算统计信息
            const distances = controlPoints.map(cp => cp.distance);
            const averageDisplacement = distances.reduce((a, b) => a + b, 0) / distances.length;
            const maxDisplacement = Math.max(...distances);
            
            // 4. 计算形状差异度 (归一化到 0-1)
            // 使用目标轮廓的对角线长度作为归一化因子
            const targetDiagonal = Math.sqrt(
                targetContour.boundingBox.width ** 2 + 
                targetContour.boundingBox.height ** 2
            );
            const shapeDifference = Math.min(1, averageDisplacement / (targetDiagonal * 0.5));
            
            // 5. 计算边界框比例
            const boundingBoxRatio = {
                widthRatio: sourceContour.boundingBox.width / targetContour.boundingBox.width,
                heightRatio: sourceContour.boundingBox.height / targetContour.boundingBox.height
            };
            
            const processingTime = Date.now() - startTime;
            
            console.log(`  形状差异度: ${(shapeDifference * 100).toFixed(1)}%`);
            console.log(`  平均位移: ${averageDisplacement.toFixed(1)}px`);
            console.log(`  最大位移: ${maxDisplacement.toFixed(1)}px`);
            console.log(`  处理耗时: ${processingTime}ms`);
            
            return {
                success: true,
                controlPoints,
                shapeDifference,
                averageDisplacement,
                maxDisplacement,
                boundingBoxRatio,
                processingTime
            };
            
        } catch (error: any) {
            console.error('[ContourAnalysis] 分析失败:', error);
            return {
                success: false,
                error: error.message,
                processingTime: Date.now() - startTime
            };
        }
    }
    
    /**
     * 有序匹配：假设两个轮廓点的顺序一致
     */
    private matchOrdered(
        source: Point2D[],
        target: Point2D[],
        weightByDistance?: boolean
    ): ControlPointPair[] {
        const controlPoints: ControlPointPair[] = [];
        const n = Math.min(source.length, target.length);
        
        // 计算所有距离以确定最大距离（用于归一化权重）
        const distances: number[] = [];
        for (let i = 0; i < n; i++) {
            const dx = target[i].x - source[i].x;
            const dy = target[i].y - source[i].y;
            distances.push(Math.sqrt(dx * dx + dy * dy));
        }
        const maxDist = Math.max(...distances, 1);
        
        for (let i = 0; i < n; i++) {
            const dist = distances[i];
            
            // 计算权重：距离越大权重越高（需要更多变形）
            const weight = weightByDistance 
                ? Math.min(1, dist / maxDist) 
                : 1;
            
            controlPoints.push({
                source: source[i],
                target: target[i],
                weight,
                distance: dist
            });
        }
        
        return controlPoints;
    }
    
    /**
     * 最近邻匹配：为每个源点找最近的目标点
     */
    private matchNearest(
        source: Point2D[],
        target: Point2D[],
        weightByDistance?: boolean
    ): ControlPointPair[] {
        const controlPoints: ControlPointPair[] = [];
        const usedTargets = new Set<number>();
        
        // 计算所有距离
        const allDistances: { i: number; j: number; dist: number }[] = [];
        
        for (let i = 0; i < source.length; i++) {
            for (let j = 0; j < target.length; j++) {
                const dx = target[j].x - source[i].x;
                const dy = target[j].y - source[i].y;
                allDistances.push({
                    i,
                    j,
                    dist: Math.sqrt(dx * dx + dy * dy)
                });
            }
        }
        
        // 按距离排序
        allDistances.sort((a, b) => a.dist - b.dist);
        
        const matched = new Set<number>();
        const maxDist = allDistances.length > 0 
            ? allDistances[allDistances.length - 1].dist 
            : 1;
        
        // 贪心匹配：优先匹配距离最近的点对
        for (const { i, j, dist } of allDistances) {
            if (matched.has(i) || usedTargets.has(j)) continue;
            
            const weight = weightByDistance 
                ? Math.min(1, dist / maxDist) 
                : 1;
            
            controlPoints.push({
                source: source[i],
                target: target[j],
                weight,
                distance: dist
            });
            
            matched.add(i);
            usedTargets.add(j);
            
            if (matched.size >= source.length) break;
        }
        
        return controlPoints;
    }
    
    /**
     * DTW (Dynamic Time Warping) 匹配
     * 适合轮廓起点不一致或方向略有差异的情况
     */
    private matchDTW(
        source: Point2D[],
        target: Point2D[],
        weightByDistance?: boolean
    ): ControlPointPair[] {
        const n = source.length;
        const m = target.length;
        
        // 构建 DTW 矩阵
        const dtw: number[][] = Array(n + 1).fill(null).map(() => 
            Array(m + 1).fill(Infinity)
        );
        dtw[0][0] = 0;
        
        // 计算距离矩阵
        const dist = (i: number, j: number): number => {
            const dx = source[i].x - target[j].x;
            const dy = source[i].y - target[j].y;
            return Math.sqrt(dx * dx + dy * dy);
        };
        
        // 填充 DTW 矩阵
        for (let i = 1; i <= n; i++) {
            for (let j = 1; j <= m; j++) {
                const cost = dist(i - 1, j - 1);
                dtw[i][j] = cost + Math.min(
                    dtw[i - 1][j],     // 插入
                    dtw[i][j - 1],     // 删除
                    dtw[i - 1][j - 1]  // 匹配
                );
            }
        }
        
        // 回溯找最优路径
        const path: { i: number; j: number }[] = [];
        let i = n, j = m;
        
        while (i > 0 && j > 0) {
            path.unshift({ i: i - 1, j: j - 1 });
            
            const diag = dtw[i - 1][j - 1];
            const left = dtw[i][j - 1];
            const up = dtw[i - 1][j];
            
            if (diag <= left && diag <= up) {
                i--; j--;
            } else if (left < up) {
                j--;
            } else {
                i--;
            }
        }
        
        // 计算最大距离用于归一化
        const distances = path.map(p => dist(p.i, p.j));
        const maxDist = Math.max(...distances, 1);
        
        // 生成控制点对
        const controlPoints: ControlPointPair[] = path.map(p => {
            const d = dist(p.i, p.j);
            return {
                source: source[p.i],
                target: target[p.j],
                weight: weightByDistance ? Math.min(1, d / maxDist) : 1,
                distance: d
            };
        });
        
        // 如果路径点太多，均匀采样
        if (controlPoints.length > source.length) {
            return this.resampleControlPoints(controlPoints, source.length);
        }
        
        return controlPoints;
    }
    
    /**
     * 均匀采样轮廓点
     */
    private resampleContour(points: Point2D[], targetCount: number): Point2D[] {
        if (points.length === 0) return [];
        if (points.length <= targetCount) return [...points];
        
        // 计算轮廓总长度
        let totalLength = 0;
        const segmentLengths: number[] = [];
        
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            const dx = points[j].x - points[i].x;
            const dy = points[j].y - points[i].y;
            const len = Math.sqrt(dx * dx + dy * dy);
            segmentLengths.push(len);
            totalLength += len;
        }
        
        // 按弧长均匀采样
        const targetSpacing = totalLength / targetCount;
        const sampled: Point2D[] = [points[0]];
        
        let accumulatedLength = 0;
        let nextSampleDist = targetSpacing;
        let segmentIdx = 0;
        let posInSegment = 0;
        
        while (sampled.length < targetCount && segmentIdx < points.length) {
            const segLen = segmentLengths[segmentIdx];
            const remainInSegment = segLen - posInSegment;
            
            if (accumulatedLength + remainInSegment >= nextSampleDist) {
                // 在当前段内采样
                const t = (nextSampleDist - accumulatedLength) / segLen + posInSegment / segLen;
                const p1 = points[segmentIdx];
                const p2 = points[(segmentIdx + 1) % points.length];
                
                sampled.push({
                    x: p1.x + t * (p2.x - p1.x),
                    y: p1.y + t * (p2.y - p1.y)
                });
                
                posInSegment = t * segLen;
                nextSampleDist += targetSpacing;
            } else {
                accumulatedLength += remainInSegment;
                segmentIdx++;
                posInSegment = 0;
            }
        }
        
        return sampled;
    }
    
    /**
     * 采样控制点对
     */
    private resampleControlPoints(
        controlPoints: ControlPointPair[],
        targetCount: number
    ): ControlPointPair[] {
        if (controlPoints.length <= targetCount) return controlPoints;
        
        const step = controlPoints.length / targetCount;
        const sampled: ControlPointPair[] = [];
        
        for (let i = 0; i < targetCount; i++) {
            const idx = Math.floor(i * step);
            sampled.push(controlPoints[idx]);
        }
        
        return sampled;
    }
    
    /**
     * 过滤控制点：移除位移太小的点（优化性能）
     */
    filterControlPoints(
        controlPoints: ControlPointPair[],
        minDisplacement: number = 2
    ): ControlPointPair[] {
        return controlPoints.filter(cp => cp.distance >= minDisplacement);
    }
    
    /**
     * 为边缘带添加额外控制点（保护内容区域）
     */
    addEdgeBandPoints(
        controlPoints: ControlPointPair[],
        sourceContour: ContourData,
        edgeBandWidth: number
    ): ControlPointPair[] {
        // 在边缘带内添加"固定点"（位移为0）以保护内容
        const innerPoints: ControlPointPair[] = [];
        
        for (const cp of controlPoints) {
            // 沿法线方向向内偏移
            // 简化：直接向质心方向偏移
            const toCenter = {
                x: sourceContour.centroid.x - cp.source.x,
                y: sourceContour.centroid.y - cp.source.y
            };
            const len = Math.sqrt(toCenter.x ** 2 + toCenter.y ** 2);
            
            if (len > 0) {
                const innerPoint: Point2D = {
                    x: cp.source.x + (toCenter.x / len) * edgeBandWidth,
                    y: cp.source.y + (toCenter.y / len) * edgeBandWidth
                };
                
                innerPoints.push({
                    source: innerPoint,
                    target: innerPoint,  // 固定点，不移动
                    weight: 0.5,
                    distance: 0
                });
            }
        }
        
        return [...controlPoints, ...innerPoints];
    }
    
    /**
     * 归一化轮廓起始点：将起始点设为最上方且最左边的点
     * 确保两个轮廓的起始点位置一致
     */
    private normalizeContourStartPoint(points: Point2D[]): Point2D[] {
        if (points.length === 0) return points;
        
        // 找到最上方（y最小）且最左边（x最小）的点
        let startIdx = 0;
        let minY = points[0].y;
        let minX = points[0].x;
        
        for (let i = 1; i < points.length; i++) {
            const p = points[i];
            if (p.y < minY || (p.y === minY && p.x < minX)) {
                startIdx = i;
                minY = p.y;
                minX = p.x;
            }
        }
        
        // 重新排列，从新的起始点开始
        if (startIdx === 0) return points;
        
        return [...points.slice(startIdx), ...points.slice(0, startIdx)];
    }
    
    /**
     * 判断轮廓是否是逆时针方向
     * 使用 Shoelace 公式：正值表示逆时针，负值表示顺时针
     */
    private isCounterClockwise(points: Point2D[]): boolean {
        if (points.length < 3) return false;
        
        let sum = 0;
        const n = points.length;
        
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            sum += (points[j].x - points[i].x) * (points[j].y + points[i].y);
        }
        
        return sum > 0;
    }
}
