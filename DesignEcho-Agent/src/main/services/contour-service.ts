/**
 * 轮廓提取服务
 * 
 * 从形状图层和产品主体提取轮廓点用于形态变形
 */

export interface Point2D {
    x: number;
    y: number;
}

export interface ContourData {
    points: Point2D[];        // 轮廓点数组
    boundingBox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    centroid: Point2D;        // 质心
    area: number;             // 面积（近似）
}

export interface ContourExtractionResult {
    success: boolean;
    contour?: ContourData;
    error?: string;
    processingTime?: number;
}

/**
 * 轮廓提取服务
 */
export class ContourService {
    private static instance: ContourService;
    
    static getInstance(): ContourService {
        if (!ContourService.instance) {
            ContourService.instance = new ContourService();
        }
        return ContourService.instance;
    }
    
    /**
     * 从抠图 mask 提取轮廓
     * @param maskBuffer - 单通道 mask 图像数据
     * @param width - mask 宽度
     * @param height - mask 高度
     * @param options - 提取选项
     */
    extractContourFromMask(
        maskBuffer: Buffer,
        width: number,
        height: number,
        options: {
            threshold?: number;      // 二值化阈值
            simplify?: number;       // 简化程度（采样间隔）
            smooth?: boolean;        // 是否平滑
        } = {}
    ): ContourExtractionResult {
        const startTime = Date.now();
        const threshold = options.threshold || 128;
        const simplify = options.simplify || 4;
        
        console.log(`[ContourService] 从 mask 提取轮廓: ${width}x${height}, threshold=${threshold}`);
        
        try {
            // 1. 边缘检测 - 找到 mask 边界像素
            const edgePixels: Point2D[] = [];
            
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;
                    const val = maskBuffer[idx];
                    
                    // 检查是否是边缘（当前像素在 mask 内，但有邻居在 mask 外）
                    if (val >= threshold) {
                        // 检查 4 邻域
                        const top = maskBuffer[(y - 1) * width + x];
                        const bottom = maskBuffer[(y + 1) * width + x];
                        const left = maskBuffer[y * width + (x - 1)];
                        const right = maskBuffer[y * width + (x + 1)];
                        
                        if (top < threshold || bottom < threshold || left < threshold || right < threshold) {
                            edgePixels.push({ x, y });
                        }
                    }
                }
            }
            
            console.log(`  检测到 ${edgePixels.length} 个边缘像素`);
            
            if (edgePixels.length === 0) {
                return { success: false, error: '未检测到轮廓边缘' };
            }
            
            // 2. 轮廓追踪 - 按顺序排列边缘点
            const orderedContour = this.traceContour(edgePixels, width, height);
            
            console.log(`  追踪得到 ${orderedContour.length} 个有序轮廓点`);
            
            // 3. 简化轮廓（按间隔采样）
            const simplifiedContour: Point2D[] = [];
            for (let i = 0; i < orderedContour.length; i += simplify) {
                simplifiedContour.push(orderedContour[i]);
            }
            
            // 确保闭合
            if (simplifiedContour.length > 2) {
                const first = simplifiedContour[0];
                const last = simplifiedContour[simplifiedContour.length - 1];
                const dist = Math.sqrt((first.x - last.x) ** 2 + (first.y - last.y) ** 2);
                if (dist > simplify) {
                    // 不自动闭合，保持开放（方便后续处理）
                }
            }
            
            console.log(`  简化后 ${simplifiedContour.length} 个轮廓点`);
            
            // 如果轮廓点太少，尝试减小简化程度重新采样
            if (simplifiedContour.length < 20 && orderedContour.length >= 20) {
                console.log('  轮廓点不足，使用更细的采样...');
                simplifiedContour.length = 0;
                const finerStep = Math.max(1, Math.floor(orderedContour.length / 50));
                for (let i = 0; i < orderedContour.length; i += finerStep) {
                    simplifiedContour.push(orderedContour[i]);
                }
                console.log(`  重新采样后 ${simplifiedContour.length} 个轮廓点`);
            }
            
            // 4. 可选：平滑处理
            const finalContour = options.smooth 
                ? this.smoothContour(simplifiedContour, 3)
                : simplifiedContour;
            
            // 5. 计算几何属性
            const boundingBox = this.computeBoundingBox(finalContour);
            const centroid = this.computeCentroid(finalContour);
            const area = this.computeArea(finalContour);
            
            const processingTime = Date.now() - startTime;
            console.log(`  轮廓提取完成，耗时 ${processingTime}ms`);
            console.log(`  边界框: (${boundingBox.x}, ${boundingBox.y}) ${boundingBox.width}x${boundingBox.height}`);
            console.log(`  质心: (${centroid.x.toFixed(1)}, ${centroid.y.toFixed(1)})`);
            
            return {
                success: true,
                contour: {
                    points: finalContour,
                    boundingBox,
                    centroid,
                    area
                },
                processingTime
            };
            
        } catch (error: any) {
            console.error('[ContourService] 轮廓提取失败:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * 从 UXP 提取的形状路径数据解析轮廓
     * @param shapeData - UXP extractShapePath 返回的数据
     */
    parseShapeContour(shapeData: any): ContourExtractionResult {
        console.log('[ContourService] 解析形状轮廓数据');
        
        try {
            if (!shapeData?.sampledPoints || shapeData.sampledPoints.length === 0) {
                return { success: false, error: '形状数据中没有采样点' };
            }
            
            const points: Point2D[] = shapeData.sampledPoints;
            
            // 计算几何属性
            const boundingBox = this.computeBoundingBox(points);
            const centroid = this.computeCentroid(points);
            const area = this.computeArea(points);
            
            console.log(`  形状轮廓: ${points.length} 个点`);
            console.log(`  边界框: (${boundingBox.x.toFixed(1)}, ${boundingBox.y.toFixed(1)}) ${boundingBox.width.toFixed(1)}x${boundingBox.height.toFixed(1)}`);
            console.log(`  质心: (${centroid.x.toFixed(1)}, ${centroid.y.toFixed(1)})`);
            
            return {
                success: true,
                contour: {
                    points,
                    boundingBox,
                    centroid,
                    area
                }
            };
            
        } catch (error: any) {
            console.error('[ContourService] 解析形状数据失败:', error);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * 轮廓追踪 - 将无序边缘点排列为有序轮廓
     */
    private traceContour(edgePixels: Point2D[], width: number, height: number): Point2D[] {
        if (edgePixels.length === 0) return [];
        
        // 创建空间索引便于快速查找邻居
        const pixelSet = new Set(edgePixels.map(p => `${p.x},${p.y}`));
        const visited = new Set<string>();
        
        // 从最左上角的点开始
        let start = edgePixels[0];
        for (const p of edgePixels) {
            if (p.y < start.y || (p.y === start.y && p.x < start.x)) {
                start = p;
            }
        }
        
        const contour: Point2D[] = [start];
        visited.add(`${start.x},${start.y}`);
        
        let current = start;
        let prevDir = 0; // 上次的方向
        
        // 8 方向搜索（顺时针）
        const dx = [1, 1, 0, -1, -1, -1, 0, 1];
        const dy = [0, 1, 1, 1, 0, -1, -1, -1];
        
        for (let iter = 0; iter < edgePixels.length * 2; iter++) {
            let found = false;
            
            // 从上次方向的下一个开始搜索
            for (let i = 0; i < 8; i++) {
                const dir = (prevDir + i + 5) % 8; // 从反方向的顺时针位置开始
                const nx = current.x + dx[dir];
                const ny = current.y + dy[dir];
                const key = `${nx},${ny}`;
                
                if (pixelSet.has(key) && !visited.has(key)) {
                    contour.push({ x: nx, y: ny });
                    visited.add(key);
                    current = { x: nx, y: ny };
                    prevDir = dir;
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                // 检查是否回到起点附近
                const dist = Math.sqrt((current.x - start.x) ** 2 + (current.y - start.y) ** 2);
                if (dist <= 2) break;
                
                // 无法继续，停止
                break;
            }
        }
        
        return contour;
    }
    
    /**
     * 平滑轮廓（移动平均）
     */
    private smoothContour(points: Point2D[], windowSize: number): Point2D[] {
        if (points.length < windowSize) return points;
        
        const smoothed: Point2D[] = [];
        const halfWindow = Math.floor(windowSize / 2);
        
        for (let i = 0; i < points.length; i++) {
            let sumX = 0, sumY = 0, count = 0;
            
            for (let j = -halfWindow; j <= halfWindow; j++) {
                const idx = (i + j + points.length) % points.length;
                sumX += points[idx].x;
                sumY += points[idx].y;
                count++;
            }
            
            smoothed.push({
                x: sumX / count,
                y: sumY / count
            });
        }
        
        return smoothed;
    }
    
    /**
     * 计算边界框
     */
    private computeBoundingBox(points: Point2D[]): ContourData['boundingBox'] {
        if (points.length === 0) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const p of points) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }
    
    /**
     * 计算质心
     */
    private computeCentroid(points: Point2D[]): Point2D {
        if (points.length === 0) {
            return { x: 0, y: 0 };
        }
        
        let sumX = 0, sumY = 0;
        for (const p of points) {
            sumX += p.x;
            sumY += p.y;
        }
        
        return {
            x: sumX / points.length,
            y: sumY / points.length
        };
    }
    
    /**
     * 计算多边形面积（Shoelace formula）
     */
    private computeArea(points: Point2D[]): number {
        if (points.length < 3) return 0;
        
        let area = 0;
        const n = points.length;
        
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        
        return Math.abs(area) / 2;
    }
    
    /**
     * 均匀采样轮廓点到指定数量
     */
    resampleContour(points: Point2D[], targetCount: number): Point2D[] {
        if (points.length <= targetCount) return [...points];
        if (targetCount <= 0) return [];
        
        const result: Point2D[] = [];
        const step = points.length / targetCount;
        
        for (let i = 0; i < targetCount; i++) {
            const idx = Math.floor(i * step);
            result.push(points[idx]);
        }
        
        return result;
    }
    
    /**
     * 归一化轮廓到 [0, 1] 范围
     */
    normalizeContour(contour: ContourData): Point2D[] {
        const { boundingBox, points } = contour;
        
        if (boundingBox.width === 0 || boundingBox.height === 0) {
            return points;
        }
        
        // 使用较大的维度作为基准，保持宽高比
        const scale = Math.max(boundingBox.width, boundingBox.height);
        
        return points.map(p => ({
            x: (p.x - boundingBox.x) / scale,
            y: (p.y - boundingBox.y) / scale
        }));
    }
}
