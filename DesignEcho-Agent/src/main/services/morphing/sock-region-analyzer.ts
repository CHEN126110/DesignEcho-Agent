/**
 * 袜子区域语义分析器
 * 
 * 识别袜子的各个部位：袜口(cuff)、袜筒(leg)、袜跟(heel)、袜身(body)、袜头(toe)
 * 分析罗口类型：平罗口(plain)、花边(lace)、蕾丝(ribbed)、双罗口(double)
 */

import sharp from 'sharp';
import { Point2D, BoundingBox } from './types';

// 袜子区域定义
export interface SockRegions {
    cuff: SockRegion;      // 袜口 - 顶部弹性区域
    leg: SockRegion;       // 袜筒 - 小腿部分
    heel: SockRegion;      // 袜跟 - 脚后跟
    body: SockRegion;      // 袜身 - 脚背/脚底
    toe: SockRegion;       // 袜头 - 脚趾区域
}

// 单个区域信息
export interface SockRegion {
    bounds: BoundingBox;           // 边界框
    contourPoints: Point2D[];      // 该区域的轮廓点
    keyPoints: KeyPoint[];         // 关键控制点
    heightRatio: [number, number]; // 高度占比范围 [start, end] (0-1)
}

// 关键点类型
export interface KeyPoint {
    position: Point2D;
    type: 'corner' | 'edge' | 'center' | 'junction';
    regionBoundary?: 'top' | 'bottom' | 'left' | 'right';
    weight: number;  // 变形时的权重 (0-1)
}

// 罗口类型
export type CuffType = 'plain' | 'ribbed' | 'lace' | 'double' | 'unknown';

// 罗口分析结果
export interface CuffAnalysisResult {
    type: CuffType;
    confidence: number;
    patternFrequency: number;    // 花纹频率（用于花边/蕾丝）
    edgeComplexity: number;      // 边缘复杂度
    doubleLayerDetected: boolean; // 是否检测到双层
    protectionLevel: number;     // 建议的保护等级 (0-1)
}

// 分析结果
export interface SockAnalysisResult {
    success: boolean;
    regions: SockRegions | null;
    cuffAnalysis: CuffAnalysisResult;
    orientation: 'vertical' | 'horizontal' | 'diagonal';
    aspectRatio: number;
    totalKeyPoints: KeyPoint[];
    processingTime: number;
    error?: string;
}

// 区域高度比例配置（基于标准袜子形态）
const REGION_HEIGHT_RATIOS = {
    cuff: [0, 0.12],      // 袜口：0-12%
    leg: [0.12, 0.35],    // 袜筒：12-35%
    heel: [0.35, 0.55],   // 袜跟：35-55%
    body: [0.55, 0.80],   // 袜身：55-80%
    toe: [0.80, 1.0]      // 袜头：80-100%
} as const;

export class SockRegionAnalyzer {
    
    /**
     * 分析袜子区域
     */
    async analyze(
        imageBuffer: Buffer | null,
        contour: Point2D[]
    ): Promise<SockAnalysisResult> {
        const startTime = performance.now();
        
        try {
            if (contour.length < 20) {
                return {
                    success: false,
                    regions: null,
                    cuffAnalysis: this.getDefaultCuffAnalysis(),
                    orientation: 'vertical',
                    aspectRatio: 1,
                    totalKeyPoints: [],
                    processingTime: performance.now() - startTime,
                    error: '轮廓点数不足'
                };
            }
            
            // 1. 计算轮廓边界和方向
            const bounds = this.computeContourBounds(contour);
            const orientation = this.detectOrientation(bounds);
            const aspectRatio = bounds.width / bounds.height;
            
            console.log(`[SockRegionAnalyzer] 边界: ${JSON.stringify(bounds)}, 方向: ${orientation}`);
            
            // 2. 标准化轮廓（确保从上到下）
            const normalizedContour = this.normalizeContour(contour, orientation);
            
            // 3. 按区域分割轮廓点
            const regions = this.segmentRegions(normalizedContour, bounds);
            
            // 4. 为每个区域生成关键控制点
            const regionsWithKeyPoints = this.generateKeyPoints(regions);
            
            // 5. 分析罗口类型
            const cuffAnalysis = await this.analyzeCuff(
                imageBuffer,
                regionsWithKeyPoints.cuff,
                bounds
            );
            
            // 6. 收集所有关键点
            const totalKeyPoints = this.collectAllKeyPoints(regionsWithKeyPoints);
            
            console.log(`[SockRegionAnalyzer] ✅ 完成分析`);
            console.log(`  - 区域: cuff(${regionsWithKeyPoints.cuff.contourPoints.length}), leg(${regionsWithKeyPoints.leg.contourPoints.length}), heel(${regionsWithKeyPoints.heel.contourPoints.length}), body(${regionsWithKeyPoints.body.contourPoints.length}), toe(${regionsWithKeyPoints.toe.contourPoints.length})`);
            console.log(`  - 罗口类型: ${cuffAnalysis.type} (置信度: ${(cuffAnalysis.confidence * 100).toFixed(1)}%)`);
            console.log(`  - 总关键点: ${totalKeyPoints.length}`);
            
            return {
                success: true,
                regions: regionsWithKeyPoints,
                cuffAnalysis,
                orientation,
                aspectRatio,
                totalKeyPoints,
                processingTime: performance.now() - startTime
            };
            
        } catch (error: any) {
            console.error('[SockRegionAnalyzer] 分析失败:', error.message);
            return {
                success: false,
                regions: null,
                cuffAnalysis: this.getDefaultCuffAnalysis(),
                orientation: 'vertical',
                aspectRatio: 1,
                totalKeyPoints: [],
                processingTime: performance.now() - startTime,
                error: error.message
            };
        }
    }
    
    /**
     * 计算轮廓边界
     */
    private computeContourBounds(contour: Point2D[]): BoundingBox {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        for (const p of contour) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
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
     * 检测袜子朝向
     */
    private detectOrientation(bounds: BoundingBox): 'vertical' | 'horizontal' | 'diagonal' {
        const ratio = bounds.height / bounds.width;
        
        if (ratio > 1.5) return 'vertical';
        if (ratio < 0.67) return 'horizontal';
        return 'diagonal';
    }
    
    /**
     * 标准化轮廓（确保从袜口到袜头的顺序）
     */
    private normalizeContour(contour: Point2D[], orientation: string): Point2D[] {
        // 按Y坐标排序（垂直方向）
        if (orientation === 'vertical') {
            return [...contour].sort((a, b) => a.y - b.y);
        }
        // 按X坐标排序（水平方向）
        if (orientation === 'horizontal') {
            return [...contour].sort((a, b) => a.x - b.x);
        }
        // 对角线方向使用距离
        const topLeft = { x: contour[0].x, y: contour[0].y };
        return [...contour].sort((a, b) => {
            const distA = Math.sqrt((a.x - topLeft.x) ** 2 + (a.y - topLeft.y) ** 2);
            const distB = Math.sqrt((b.x - topLeft.x) ** 2 + (b.y - topLeft.y) ** 2);
            return distA - distB;
        });
    }
    
    /**
     * 按区域分割轮廓点
     */
    private segmentRegions(contour: Point2D[], bounds: BoundingBox): SockRegions {
        const regions: SockRegions = {
            cuff: this.createEmptyRegion(REGION_HEIGHT_RATIOS.cuff),
            leg: this.createEmptyRegion(REGION_HEIGHT_RATIOS.leg),
            heel: this.createEmptyRegion(REGION_HEIGHT_RATIOS.heel),
            body: this.createEmptyRegion(REGION_HEIGHT_RATIOS.body),
            toe: this.createEmptyRegion(REGION_HEIGHT_RATIOS.toe)
        };
        
        // 将每个点分配到对应区域
        for (const point of contour) {
            // 计算点在袜子中的相对位置 (0-1)
            const relativeY = (point.y - bounds.y) / bounds.height;
            
            if (relativeY < REGION_HEIGHT_RATIOS.cuff[1]) {
                regions.cuff.contourPoints.push(point);
            } else if (relativeY < REGION_HEIGHT_RATIOS.leg[1]) {
                regions.leg.contourPoints.push(point);
            } else if (relativeY < REGION_HEIGHT_RATIOS.heel[1]) {
                regions.heel.contourPoints.push(point);
            } else if (relativeY < REGION_HEIGHT_RATIOS.body[1]) {
                regions.body.contourPoints.push(point);
            } else {
                regions.toe.contourPoints.push(point);
            }
        }
        
        // 计算每个区域的边界框
        for (const key of Object.keys(regions) as (keyof SockRegions)[]) {
            if (regions[key].contourPoints.length > 0) {
                regions[key].bounds = this.computeContourBounds(regions[key].contourPoints);
            }
        }
        
        return regions;
    }
    
    /**
     * 创建空区域
     */
    private createEmptyRegion(heightRatio: readonly [number, number]): SockRegion {
        return {
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            contourPoints: [],
            keyPoints: [],
            heightRatio: [heightRatio[0], heightRatio[1]]
        };
    }
    
    /**
     * 为每个区域生成关键控制点
     */
    private generateKeyPoints(regions: SockRegions): SockRegions {
        const result = { ...regions };
        
        for (const key of Object.keys(result) as (keyof SockRegions)[]) {
            const region = result[key];
            if (region.contourPoints.length === 0) continue;
            
            const keyPoints: KeyPoint[] = [];
            const points = region.contourPoints;
            const bounds = region.bounds;
            
            // 1. 添加角点
            keyPoints.push(...this.findCornerPoints(points, bounds, key));
            
            // 2. 添加边缘采样点（每边3-5个点）
            keyPoints.push(...this.sampleEdgePoints(points, bounds, 4));
            
            // 3. 添加区域边界连接点
            keyPoints.push(...this.findJunctionPoints(points, region.heightRatio));
            
            result[key].keyPoints = keyPoints;
        }
        
        return result;
    }
    
    /**
     * 查找角点
     */
    private findCornerPoints(
        points: Point2D[],
        bounds: BoundingBox,
        regionKey: keyof SockRegions
    ): KeyPoint[] {
        const corners: KeyPoint[] = [];
        const tolerance = Math.min(bounds.width, bounds.height) * 0.1;
        
        // 找到最接近四个角的点
        const targets = [
            { x: bounds.x, y: bounds.y, boundary: 'top' as const },
            { x: bounds.x + bounds.width, y: bounds.y, boundary: 'top' as const },
            { x: bounds.x, y: bounds.y + bounds.height, boundary: 'bottom' as const },
            { x: bounds.x + bounds.width, y: bounds.y + bounds.height, boundary: 'bottom' as const }
        ];
        
        for (const target of targets) {
            let closestPoint = points[0];
            let minDist = Infinity;
            
            for (const p of points) {
                const dist = Math.sqrt((p.x - target.x) ** 2 + (p.y - target.y) ** 2);
                if (dist < minDist) {
                    minDist = dist;
                    closestPoint = p;
                }
            }
            
            if (minDist < tolerance) {
                // 根据区域设置权重（袜口和袜头区域权重更高）
                const weight = (regionKey === 'cuff' || regionKey === 'toe') ? 1.0 : 0.8;
                
                corners.push({
                    position: closestPoint,
                    type: 'corner',
                    regionBoundary: target.boundary,
                    weight
                });
            }
        }
        
        return corners;
    }
    
    /**
     * 采样边缘点
     */
    private sampleEdgePoints(
        points: Point2D[],
        bounds: BoundingBox,
        countPerSide: number
    ): KeyPoint[] {
        const edgePoints: KeyPoint[] = [];
        const centerX = bounds.x + bounds.width / 2;
        
        // 分离左右边缘
        const leftPoints = points.filter(p => p.x < centerX);
        const rightPoints = points.filter(p => p.x >= centerX);
        
        // 左边采样
        if (leftPoints.length >= countPerSide) {
            const step = Math.floor(leftPoints.length / countPerSide);
            for (let i = 0; i < countPerSide; i++) {
                const idx = Math.min(i * step, leftPoints.length - 1);
                edgePoints.push({
                    position: leftPoints[idx],
                    type: 'edge',
                    regionBoundary: 'left',
                    weight: 0.6
                });
            }
        }
        
        // 右边采样
        if (rightPoints.length >= countPerSide) {
            const step = Math.floor(rightPoints.length / countPerSide);
            for (let i = 0; i < countPerSide; i++) {
                const idx = Math.min(i * step, rightPoints.length - 1);
                edgePoints.push({
                    position: rightPoints[idx],
                    type: 'edge',
                    regionBoundary: 'right',
                    weight: 0.6
                });
            }
        }
        
        return edgePoints;
    }
    
    /**
     * 查找区域连接点
     */
    private findJunctionPoints(
        points: Point2D[],
        heightRatio: [number, number]
    ): KeyPoint[] {
        if (points.length === 0) return [];
        
        // 找到区域顶部和底部的中心点
        const sortedByY = [...points].sort((a, b) => a.y - b.y);
        const topPoints = sortedByY.slice(0, Math.ceil(sortedByY.length * 0.1));
        const bottomPoints = sortedByY.slice(-Math.ceil(sortedByY.length * 0.1));
        
        const junctions: KeyPoint[] = [];
        
        // 顶部中心
        if (topPoints.length > 0) {
            const avgX = topPoints.reduce((s, p) => s + p.x, 0) / topPoints.length;
            const avgY = topPoints.reduce((s, p) => s + p.y, 0) / topPoints.length;
            junctions.push({
                position: { x: avgX, y: avgY },
                type: 'junction',
                regionBoundary: 'top',
                weight: 0.9  // 区域连接点权重较高
            });
        }
        
        // 底部中心
        if (bottomPoints.length > 0) {
            const avgX = bottomPoints.reduce((s, p) => s + p.x, 0) / bottomPoints.length;
            const avgY = bottomPoints.reduce((s, p) => s + p.y, 0) / bottomPoints.length;
            junctions.push({
                position: { x: avgX, y: avgY },
                type: 'junction',
                regionBoundary: 'bottom',
                weight: 0.9
            });
        }
        
        return junctions;
    }
    
    /**
     * 分析罗口类型
     */
    private async analyzeCuff(
        imageBuffer: Buffer | null,
        cuffRegion: SockRegion,
        fullBounds: BoundingBox
    ): Promise<CuffAnalysisResult> {
        if (cuffRegion.contourPoints.length < 5) {
            return this.getDefaultCuffAnalysis();
        }
        
        const points = cuffRegion.contourPoints;
        
        // 1. 计算边缘复杂度（锯齿程度）
        const edgeComplexity = this.computeEdgeComplexity(points);
        
        // 2. 检测周期性花纹（花边特征）
        const patternFrequency = this.detectPatternFrequency(points);
        
        // 3. 检测双层结构
        const doubleLayerDetected = await this.detectDoubleLayer(imageBuffer, cuffRegion.bounds);
        
        // 4. 综合判断罗口类型
        let type: CuffType = 'plain';
        let confidence = 0;
        
        if (doubleLayerDetected) {
            type = 'double';
            confidence = 0.8;
        } else if (edgeComplexity > 0.7 && patternFrequency > 0.5) {
            type = 'lace';
            confidence = Math.min(edgeComplexity, patternFrequency);
        } else if (patternFrequency > 0.4) {
            type = 'ribbed';
            confidence = patternFrequency;
        } else {
            type = 'plain';
            confidence = 1 - edgeComplexity;
        }
        
        // 5. 计算建议的保护等级
        const protectionLevel = this.calculateProtectionLevel(type, edgeComplexity);
        
        return {
            type,
            confidence,
            patternFrequency,
            edgeComplexity,
            doubleLayerDetected,
            protectionLevel
        };
    }
    
    /**
     * 计算边缘复杂度
     */
    private computeEdgeComplexity(points: Point2D[]): number {
        if (points.length < 3) return 0;
        
        // 计算连续点之间的方向变化
        let totalAngleChange = 0;
        
        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const next = points[i + 1];
            
            const angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
            const angle2 = Math.atan2(next.y - curr.y, next.x - curr.x);
            
            let angleDiff = Math.abs(angle2 - angle1);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
            
            totalAngleChange += angleDiff;
        }
        
        // 归一化到 0-1
        const avgChange = totalAngleChange / (points.length - 2);
        return Math.min(avgChange / (Math.PI / 4), 1);  // π/4 为高复杂度阈值
    }
    
    /**
     * 检测周期性花纹
     */
    private detectPatternFrequency(points: Point2D[]): number {
        if (points.length < 10) return 0;
        
        // 使用自相关检测周期性
        // 简化实现：检测Y方向的周期性波动
        const yValues = points.map(p => p.y);
        const mean = yValues.reduce((s, v) => s + v, 0) / yValues.length;
        const normalized = yValues.map(v => v - mean);
        
        // 计算自相关
        let maxCorr = 0;
        let bestPeriod = 0;
        
        for (let lag = 2; lag < normalized.length / 2; lag++) {
            let corr = 0;
            let count = 0;
            
            for (let i = 0; i < normalized.length - lag; i++) {
                corr += normalized[i] * normalized[i + lag];
                count++;
            }
            
            corr /= count;
            
            if (corr > maxCorr) {
                maxCorr = corr;
                bestPeriod = lag;
            }
        }
        
        // 归一化相关度
        const variance = normalized.reduce((s, v) => s + v * v, 0) / normalized.length;
        return variance > 0 ? Math.min(maxCorr / variance, 1) : 0;
    }
    
    /**
     * 检测双层结构
     */
    private async detectDoubleLayer(
        imageBuffer: Buffer | null,
        cuffBounds: BoundingBox
    ): Promise<boolean> {
        if (!imageBuffer || cuffBounds.width === 0) return false;
        
        try {
            // 分析袜口区域的水平亮度梯度
            const metadata = await sharp(imageBuffer).metadata();
            if (!metadata.width || !metadata.height) return false;
            
            // 提取袜口区域
            const left = Math.max(0, Math.floor(cuffBounds.x));
            const top = Math.max(0, Math.floor(cuffBounds.y));
            const width = Math.min(
                Math.floor(cuffBounds.width),
                metadata.width - left
            );
            const height = Math.min(
                Math.floor(cuffBounds.height),
                metadata.height - top
            );
            
            if (width <= 0 || height <= 0) return false;
            
            const cuffData = await sharp(imageBuffer)
                .extract({ left, top, width, height })
                .grayscale()
                .raw()
                .toBuffer();
            
            // 分析水平线的亮度分布
            // 双罗口通常有两条明显的水平边界
            const horizontalProfile: number[] = [];
            
            for (let y = 0; y < height; y++) {
                let rowSum = 0;
                for (let x = 0; x < width; x++) {
                    rowSum += cuffData[y * width + x];
                }
                horizontalProfile.push(rowSum / width);
            }
            
            // 检测峰值数量
            let peakCount = 0;
            const threshold = 20;  // 亮度变化阈值
            
            for (let i = 1; i < horizontalProfile.length - 1; i++) {
                const diff1 = horizontalProfile[i] - horizontalProfile[i - 1];
                const diff2 = horizontalProfile[i + 1] - horizontalProfile[i];
                
                if (Math.abs(diff1) > threshold && Math.abs(diff2) > threshold) {
                    if (Math.sign(diff1) !== Math.sign(diff2)) {
                        peakCount++;
                    }
                }
            }
            
            // 2个或更多峰值可能表示双罗口
            return peakCount >= 2;
            
        } catch (error) {
            console.warn('[SockRegionAnalyzer] 双层检测失败:', error);
            return false;
        }
    }
    
    /**
     * 计算保护等级
     */
    private calculateProtectionLevel(type: CuffType, edgeComplexity: number): number {
        switch (type) {
            case 'lace':
                return 0.9;  // 花边需要最高保护
            case 'double':
                return 0.85;
            case 'ribbed':
                return 0.7;
            case 'plain':
                return 0.5 + edgeComplexity * 0.3;
            default:
                return 0.6;
        }
    }
    
    /**
     * 收集所有关键点
     */
    private collectAllKeyPoints(regions: SockRegions): KeyPoint[] {
        const allPoints: KeyPoint[] = [];
        
        for (const key of Object.keys(regions) as (keyof SockRegions)[]) {
            allPoints.push(...regions[key].keyPoints);
        }
        
        return allPoints;
    }
    
    /**
     * 默认罗口分析结果
     */
    private getDefaultCuffAnalysis(): CuffAnalysisResult {
        return {
            type: 'plain',
            confidence: 0.5,
            patternFrequency: 0,
            edgeComplexity: 0,
            doubleLayerDetected: false,
            protectionLevel: 0.5
        };
    }
    
    /**
     * 匹配两个袜子的区域关键点
     * 用于变形时的点对点对应
     */
    matchKeyPoints(
        sourceRegions: SockRegions,
        targetRegions: SockRegions
    ): Array<{ source: KeyPoint; target: KeyPoint; regionKey: keyof SockRegions }> {
        const pairs: Array<{ source: KeyPoint; target: KeyPoint; regionKey: keyof SockRegions }> = [];
        
        // 按区域匹配
        for (const key of Object.keys(sourceRegions) as (keyof SockRegions)[]) {
            const sourcePoints = sourceRegions[key].keyPoints;
            const targetPoints = targetRegions[key].keyPoints;
            
            // 按类型和边界匹配
            for (const sp of sourcePoints) {
                // 找到同类型、同边界的目标点
                const matched = targetPoints.find(tp =>
                    tp.type === sp.type &&
                    tp.regionBoundary === sp.regionBoundary
                );
                
                if (matched) {
                    pairs.push({ source: sp, target: matched, regionKey: key });
                }
            }
        }
        
        return pairs;
    }
}

// 单例
let analyzerInstance: SockRegionAnalyzer | null = null;

export function getSockRegionAnalyzer(): SockRegionAnalyzer {
    if (!analyzerInstance) {
        analyzerInstance = new SockRegionAnalyzer();
    }
    return analyzerInstance;
}
