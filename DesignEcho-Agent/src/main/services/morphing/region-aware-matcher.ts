/**
 * 区域感知的点匹配器
 * 
 * 基于袜子各部位进行精确的控制点匹配
 * 确保袜口对袜口、袜跟对袜跟等
 */

import { Point2D, ControlPointPair, BoundingBox } from './types';
import { SockRegions, KeyPoint, CuffAnalysisResult } from './sock-region-analyzer';

// 匹配配置
export interface MatcherConfig {
    // 每个区域的采样点数
    pointsPerRegion: {
        cuff: number;   // 袜口
        leg: number;    // 袜筒
        heel: number;   // 袜跟
        body: number;   // 袜身
        toe: number;    // 袜头
    };
    
    // 区域权重（变形时的影响力）
    regionWeights: {
        cuff: number;
        leg: number;
        heel: number;
        body: number;
        toe: number;
    };
    
    // 是否使用智能重采样
    useAdaptiveSampling: boolean;
    
    // 曲率敏感采样
    curvatureSensitivity: number;  // 0-1
}

// 默认配置
export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
    pointsPerRegion: {
        cuff: 12,   // 袜口需要更多点来保持形状
        leg: 8,
        heel: 10,   // 袜跟形状复杂
        body: 8,
        toe: 10     // 袜头也需要精确控制
    },
    regionWeights: {
        cuff: 1.0,  // 袜口权重最高（用户关注点）
        leg: 0.7,
        heel: 0.9,  // 袜跟形状重要
        body: 0.6,
        toe: 0.85   // 袜头也重要
    },
    useAdaptiveSampling: true,
    curvatureSensitivity: 0.5
};

// 匹配结果
export interface MatchingResult {
    controlPairs: ControlPointPair[];
    regionMapping: Map<keyof SockRegions, ControlPointPair[]>;
    qualityScore: number;  // 匹配质量分数 0-1
    warnings: string[];
}

export class RegionAwareMatcher {
    private config: MatcherConfig;
    
    constructor(config: Partial<MatcherConfig> = {}) {
        this.config = { ...DEFAULT_MATCHER_CONFIG, ...config };
    }
    
    /**
     * 执行区域感知的点匹配
     */
    match(
        sourceRegions: SockRegions,
        targetRegions: SockRegions,
        sourceCuffAnalysis?: CuffAnalysisResult,
        targetCuffAnalysis?: CuffAnalysisResult
    ): MatchingResult {
        console.log('[RegionAwareMatcher] 开始区域感知匹配...');
        
        const controlPairs: ControlPointPair[] = [];
        const regionMapping = new Map<keyof SockRegions, ControlPointPair[]>();
        const warnings: string[] = [];
        
        const regionKeys: (keyof SockRegions)[] = ['cuff', 'leg', 'heel', 'body', 'toe'];
        
        for (const key of regionKeys) {
            const sourceRegion = sourceRegions[key];
            const targetRegion = targetRegions[key];
            
            // 检查区域有效性
            if (sourceRegion.contourPoints.length < 3) {
                warnings.push(`源图层 ${key} 区域点数不足`);
                continue;
            }
            if (targetRegion.contourPoints.length < 3) {
                warnings.push(`目标形状 ${key} 区域点数不足`);
                continue;
            }
            
            // 获取该区域的配置
            const numPoints = this.config.pointsPerRegion[key];
            const weight = this.config.regionWeights[key];
            
            // 对罗口区域进行特殊处理
            let adjustedWeight = weight;
            if (key === 'cuff' && sourceCuffAnalysis && targetCuffAnalysis) {
                adjustedWeight = this.adjustCuffWeight(
                    sourceCuffAnalysis,
                    targetCuffAnalysis,
                    weight
                );
            }
            
            // 采样控制点
            const pairs = this.matchRegion(
                sourceRegion.contourPoints,
                targetRegion.contourPoints,
                numPoints,
                adjustedWeight,
                key
            );
            
            controlPairs.push(...pairs);
            regionMapping.set(key, pairs);
            
            console.log(`  - ${key}: ${pairs.length} 对控制点, 权重 ${adjustedWeight.toFixed(2)}`);
        }
        
        // 添加区域边界连接点
        const junctionPairs = this.matchJunctions(sourceRegions, targetRegions);
        controlPairs.push(...junctionPairs);
        
        // 计算匹配质量
        const qualityScore = this.evaluateMatchingQuality(controlPairs, warnings);
        
        console.log(`[RegionAwareMatcher] ✅ 完成: ${controlPairs.length} 对控制点, 质量 ${(qualityScore * 100).toFixed(1)}%`);
        
        return {
            controlPairs,
            regionMapping,
            qualityScore,
            warnings
        };
    }
    
    /**
     * 匹配单个区域的点
     */
    private matchRegion(
        sourcePoints: Point2D[],
        targetPoints: Point2D[],
        numSamples: number,
        weight: number,
        regionKey: keyof SockRegions
    ): ControlPointPair[] {
        // 重采样到相同数量的点
        const sampledSource = this.resampleContour(sourcePoints, numSamples);
        const sampledTarget = this.resampleContour(targetPoints, numSamples);
        
        const pairs: ControlPointPair[] = [];
        
        // 一一对应匹配
        for (let i = 0; i < Math.min(sampledSource.length, sampledTarget.length); i++) {
            pairs.push({
                source: sampledSource[i],
                target: sampledTarget[i],
                weight: weight
            });
        }
        
        return pairs;
    }
    
    /**
     * 重采样轮廓到指定数量的点
     */
    private resampleContour(points: Point2D[], targetCount: number): Point2D[] {
        if (points.length <= targetCount) {
            return [...points];
        }
        
        if (this.config.useAdaptiveSampling) {
            return this.adaptiveResample(points, targetCount);
        }
        
        // 均匀采样
        return this.uniformResample(points, targetCount);
    }
    
    /**
     * 均匀重采样
     */
    private uniformResample(points: Point2D[], targetCount: number): Point2D[] {
        const result: Point2D[] = [];
        const step = (points.length - 1) / (targetCount - 1);
        
        for (let i = 0; i < targetCount; i++) {
            const idx = Math.min(Math.floor(i * step), points.length - 1);
            result.push(points[idx]);
        }
        
        return result;
    }
    
    /**
     * 自适应重采样（曲率敏感）
     */
    private adaptiveResample(points: Point2D[], targetCount: number): Point2D[] {
        // 计算每个点的曲率
        const curvatures = this.computeCurvatures(points);
        
        // 根据曲率分配采样权重
        const weights = curvatures.map(c => 
            1 + c * this.config.curvatureSensitivity * 2
        );
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        
        const result: Point2D[] = [];
        let accumulated = 0;
        const threshold = totalWeight / targetCount;
        
        for (let i = 0; i < points.length && result.length < targetCount; i++) {
            accumulated += weights[i];
            if (accumulated >= threshold * result.length || i === 0 || i === points.length - 1) {
                result.push(points[i]);
            }
        }
        
        // 确保达到目标数量
        while (result.length < targetCount && points.length > 0) {
            const idx = Math.floor((result.length / targetCount) * points.length);
            result.push(points[Math.min(idx, points.length - 1)]);
        }
        
        return result;
    }
    
    /**
     * 计算每个点的曲率
     */
    private computeCurvatures(points: Point2D[]): number[] {
        const curvatures: number[] = new Array(points.length).fill(0);
        
        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const next = points[i + 1];
            
            // 使用三点计算曲率
            const v1 = { x: curr.x - prev.x, y: curr.y - prev.y };
            const v2 = { x: next.x - curr.x, y: next.y - curr.y };
            
            const cross = v1.x * v2.y - v1.y * v2.x;
            const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
            const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
            
            if (len1 > 0 && len2 > 0) {
                curvatures[i] = Math.abs(cross) / (len1 * len2);
            }
        }
        
        return curvatures;
    }
    
    /**
     * 根据罗口类型调整权重
     */
    private adjustCuffWeight(
        sourceCuff: CuffAnalysisResult,
        targetCuff: CuffAnalysisResult,
        baseWeight: number
    ): number {
        // 如果罗口类型不同，降低权重以减少变形
        if (sourceCuff.type !== targetCuff.type) {
            console.log(`  [罗口类型不匹配] 源: ${sourceCuff.type}, 目标: ${targetCuff.type}`);
            return baseWeight * 0.5;  // 降低权重
        }
        
        // 复杂罗口（花边、双罗口）增加保护
        if (sourceCuff.type === 'lace' || sourceCuff.type === 'double') {
            return baseWeight * sourceCuff.protectionLevel;
        }
        
        return baseWeight;
    }
    
    /**
     * 匹配区域边界连接点
     */
    private matchJunctions(
        sourceRegions: SockRegions,
        targetRegions: SockRegions
    ): ControlPointPair[] {
        const pairs: ControlPointPair[] = [];
        const regionKeys: (keyof SockRegions)[] = ['cuff', 'leg', 'heel', 'body', 'toe'];
        
        // 匹配相邻区域的边界
        for (let i = 0; i < regionKeys.length - 1; i++) {
            const currentKey = regionKeys[i];
            const nextKey = regionKeys[i + 1];
            
            // 获取当前区域底部和下一区域顶部的点
            const sourceBottom = this.getRegionBoundary(sourceRegions[currentKey], 'bottom');
            const targetBottom = this.getRegionBoundary(targetRegions[currentKey], 'bottom');
            
            if (sourceBottom && targetBottom) {
                pairs.push({
                    source: sourceBottom,
                    target: targetBottom,
                    weight: 0.95  // 边界点权重很高
                });
            }
        }
        
        return pairs;
    }
    
    /**
     * 获取区域边界点
     */
    private getRegionBoundary(
        region: { contourPoints: Point2D[]; bounds: BoundingBox },
        boundary: 'top' | 'bottom'
    ): Point2D | null {
        if (region.contourPoints.length === 0) return null;
        
        const sorted = [...region.contourPoints].sort((a, b) => a.y - b.y);
        
        if (boundary === 'top') {
            // 取顶部点的平均
            const topPoints = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.1)));
            return {
                x: topPoints.reduce((s, p) => s + p.x, 0) / topPoints.length,
                y: topPoints.reduce((s, p) => s + p.y, 0) / topPoints.length
            };
        } else {
            // 取底部点的平均
            const bottomPoints = sorted.slice(-Math.max(1, Math.floor(sorted.length * 0.1)));
            return {
                x: bottomPoints.reduce((s, p) => s + p.x, 0) / bottomPoints.length,
                y: bottomPoints.reduce((s, p) => s + p.y, 0) / bottomPoints.length
            };
        }
    }
    
    /**
     * 评估匹配质量
     */
    private evaluateMatchingQuality(
        pairs: ControlPointPair[],
        warnings: string[]
    ): number {
        if (pairs.length === 0) return 0;
        
        let score = 1.0;
        
        // 扣分：警告
        score -= warnings.length * 0.1;
        
        // 扣分：点数不足
        const minPoints = 20;
        if (pairs.length < minPoints) {
            score -= (minPoints - pairs.length) * 0.02;
        }
        
        // 扣分：权重分布不均
        const weights = pairs.map(p => p.weight);
        const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
        const weightVariance = weights.reduce((s, w) => s + (w - avgWeight) ** 2, 0) / weights.length;
        score -= weightVariance * 0.5;
        
        return Math.max(0, Math.min(1, score));
    }
    
    /**
     * 更新配置
     */
    updateConfig(config: Partial<MatcherConfig>): void {
        this.config = { ...this.config, ...config };
    }
}

// 单例
let matcherInstance: RegionAwareMatcher | null = null;

export function getRegionAwareMatcher(): RegionAwareMatcher {
    if (!matcherInstance) {
        matcherInstance = new RegionAwareMatcher();
    }
    return matcherInstance;
}
