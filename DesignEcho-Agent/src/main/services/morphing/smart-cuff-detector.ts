/**
 * 智能袜口检测器
 * 
 * 自动识别袜口类型并生成保护区域
 * 支持: 普通袜口、花边、双层、罗口花边
 */

import { Point2D, BoundingBox, CuffType, CuffDetectionResult } from './types';

/**
 * 袜口检测配置
 */
interface CuffDetectorConfig {
    // 袜口位置假设 (图像上部区域)
    topRegionRatio: number;      // 默认 0.25 (上部 25%)
    
    // 边缘复杂度阈值
    laceComplexityThreshold: number;  // 花边判定阈值
    ribbedComplexityThreshold: number; // 罗口判定阈值
    
    // 对称性阈值
    symmetryThreshold: number;
    
    // 最小置信度
    minConfidence: number;
}

const DEFAULT_CONFIG: CuffDetectorConfig = {
    topRegionRatio: 0.25,
    laceComplexityThreshold: 0.7,
    ribbedComplexityThreshold: 0.4,
    symmetryThreshold: 0.6,
    minConfidence: 0.5
};

/**
 * 智能袜口检测器
 */
export class SmartCuffDetector {
    private config: CuffDetectorConfig;
    
    constructor(config: Partial<CuffDetectorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    
    /**
     * 检测袜口
     * @param contour 产品轮廓
     * @param imageBounds 图像边界
     * @returns 袜口检测结果
     */
    detect(
        contour: Point2D[],
        imageBounds: BoundingBox
    ): CuffDetectionResult {
        console.log(`[CuffDetector] 开始检测, 轮廓点数: ${contour.length}`);
        const startTime = performance.now();
        
        // 1. 分析位置特征
        const positionFeature = this.analyzePosition(contour, imageBounds);
        
        // 2. 提取袜口区域轮廓
        const cuffContour = this.extractCuffContour(contour, imageBounds);
        
        // 3. 分析边缘复杂度
        const complexityFeature = this.analyzeEdgeComplexity(cuffContour);
        
        // 4. 分析对称性
        const symmetryFeature = this.analyzeSymmetry(cuffContour, imageBounds);
        
        // 5. 分类袜口类型
        const { type, confidence } = this.classifyCuffType({
            position: positionFeature,
            complexity: complexityFeature,
            symmetry: symmetryFeature
        });
        
        // 6. 计算保护区域
        const region = this.computeCuffRegion(cuffContour, imageBounds, type);
        
        const duration = performance.now() - startTime;
        console.log(`[CuffDetector] ✅ 检测完成: ${type} (置信度: ${confidence.toFixed(2)}), 耗时 ${duration.toFixed(2)}ms`);
        
        return {
            type,
            region,
            confidence,
            features: {
                position: positionFeature,
                complexity: complexityFeature,
                symmetry: symmetryFeature
            }
        };
    }
    
    /**
     * 分析位置特征
     * 袜口通常在图像上部
     */
    private analyzePosition(contour: Point2D[], bounds: BoundingBox): number {
        // 找到轮廓最高点和最低点
        let minY = Infinity, maxY = -Infinity;
        
        for (const point of contour) {
            if (point.y < minY) minY = point.y;
            if (point.y > maxY) maxY = point.y;
        }
        
        // 计算袜口在图像中的相对位置
        const contourHeight = maxY - minY;
        const relativeTop = (minY - bounds.y) / bounds.height;
        
        // 如果轮廓顶部在图像上部，位置得分高
        const score = Math.max(0, 1 - relativeTop * 3);
        
        console.log(`[CuffDetector] 位置分析: 顶部=${relativeTop.toFixed(2)}, 得分=${score.toFixed(2)}`);
        return score;
    }
    
    /**
     * 提取袜口区域轮廓
     */
    private extractCuffContour(contour: Point2D[], bounds: BoundingBox): Point2D[] {
        // 找到轮廓的 Y 范围
        let minY = Infinity, maxY = -Infinity;
        for (const point of contour) {
            if (point.y < minY) minY = point.y;
            if (point.y > maxY) maxY = point.y;
        }
        
        const height = maxY - minY;
        const cuffThreshold = minY + height * this.config.topRegionRatio;
        
        // 提取上部区域的点
        return contour.filter(p => p.y < cuffThreshold);
    }
    
    /**
     * 分析边缘复杂度
     * 花边边缘有高频变化，普通边缘平滑
     */
    private analyzeEdgeComplexity(contour: Point2D[]): number {
        if (contour.length < 10) {
            return 0;
        }
        
        // 计算曲率变化
        const curvatures: number[] = [];
        
        for (let i = 2; i < contour.length; i++) {
            const p0 = contour[i - 2];
            const p1 = contour[i - 1];
            const p2 = contour[i];
            
            // 计算两个向量
            const v1 = { x: p1.x - p0.x, y: p1.y - p0.y };
            const v2 = { x: p2.x - p1.x, y: p2.y - p1.y };
            
            // 计算角度变化
            const dot = v1.x * v2.x + v1.y * v2.y;
            const cross = v1.x * v2.y - v1.y * v2.x;
            const angle = Math.atan2(cross, dot);
            
            curvatures.push(Math.abs(angle));
        }
        
        // 计算高频变化
        let highFreqCount = 0;
        const threshold = Math.PI / 6;  // 30度
        
        for (let i = 1; i < curvatures.length; i++) {
            if (Math.abs(curvatures[i] - curvatures[i - 1]) > threshold) {
                highFreqCount++;
            }
        }
        
        // 归一化复杂度得分
        const complexity = Math.min(1, highFreqCount / (curvatures.length * 0.3));
        
        console.log(`[CuffDetector] 复杂度分析: 高频点=${highFreqCount}/${curvatures.length}, 得分=${complexity.toFixed(2)}`);
        return complexity;
    }
    
    /**
     * 分析对称性
     * 花边通常是对称的
     */
    private analyzeSymmetry(contour: Point2D[], bounds: BoundingBox): number {
        if (contour.length < 4) {
            return 0;
        }
        
        // 找到中心线
        let sumX = 0;
        for (const p of contour) {
            sumX += p.x;
        }
        const centerX = sumX / contour.length;
        
        // 将点分为左右两侧
        const leftPoints = contour.filter(p => p.x < centerX);
        const rightPoints = contour.filter(p => p.x >= centerX);
        
        if (leftPoints.length === 0 || rightPoints.length === 0) {
            return 0;
        }
        
        // 计算对称性得分
        // 对于每个左侧点，找到右侧最近的镜像点
        let symmetryScore = 0;
        
        for (const lp of leftPoints) {
            // 计算镜像位置
            const mirrorX = 2 * centerX - lp.x;
            
            // 找到右侧最近的点
            let minDist = Infinity;
            for (const rp of rightPoints) {
                const dx = rp.x - mirrorX;
                const dy = rp.y - lp.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist) {
                    minDist = dist;
                }
            }
            
            // 距离越小，对称性越好
            const pointScore = Math.exp(-minDist / 20);
            symmetryScore += pointScore;
        }
        
        const normalizedScore = symmetryScore / leftPoints.length;
        
        console.log(`[CuffDetector] 对称性分析: 得分=${normalizedScore.toFixed(2)}`);
        return normalizedScore;
    }
    
    /**
     * 分类袜口类型
     */
    private classifyCuffType(features: {
        position: number;
        complexity: number;
        symmetry: number;
    }): { type: CuffType; confidence: number } {
        const { position, complexity, symmetry } = features;
        
        // 决策逻辑
        let type: CuffType;
        let confidence: number;
        
        if (position < 0.3) {
            // 位置不像袜口
            type = 'unknown';
            confidence = 0.3;
        } else if (complexity >= this.config.laceComplexityThreshold && symmetry >= this.config.symmetryThreshold) {
            // 高复杂度 + 高对称性 = 花边
            type = 'lace';
            confidence = Math.min(complexity, symmetry);
        } else if (complexity >= this.config.ribbedComplexityThreshold && complexity < this.config.laceComplexityThreshold) {
            // 中等复杂度 = 罗口或双层
            if (symmetry >= this.config.symmetryThreshold) {
                type = 'ribbed';
                confidence = (complexity + symmetry) / 2;
            } else {
                type = 'double';
                confidence = complexity * 0.8;
            }
        } else {
            // 低复杂度 = 普通袜口
            type = 'plain';
            confidence = 1 - complexity;
        }
        
        console.log(`[CuffDetector] 分类结果: ${type}, 置信度=${confidence.toFixed(2)}`);
        return { type, confidence };
    }
    
    /**
     * 计算袜口保护区域
     */
    private computeCuffRegion(
        cuffContour: Point2D[],
        imageBounds: BoundingBox,
        type: CuffType
    ): BoundingBox {
        if (cuffContour.length === 0) {
            // 默认保护上部 20% 区域
            return {
                x: imageBounds.x,
                y: imageBounds.y,
                width: imageBounds.width,
                height: imageBounds.height * 0.2
            };
        }
        
        // 计算袜口边界
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        for (const p of cuffContour) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        
        // 根据类型扩展保护区域
        let padding = 0;
        switch (type) {
            case 'lace':
                padding = 20;  // 花边需要更大的保护区域
                break;
            case 'double':
                padding = 15;
                break;
            case 'ribbed':
                padding = 10;
                break;
            default:
                padding = 5;
        }
        
        return {
            x: Math.max(0, minX - padding),
            y: Math.max(0, minY - padding),
            width: (maxX - minX) + 2 * padding,
            height: (maxY - minY) + 2 * padding
        };
    }
    
    /**
     * 生成袜口保护掩码
     */
    generateProtectionMask(
        width: number,
        height: number,
        cuffResult: CuffDetectionResult
    ): Uint8Array {
        const mask = new Uint8Array(width * height);
        
        // 如果类型需要保护
        if (cuffResult.type === 'lace' || cuffResult.type === 'double' || cuffResult.type === 'ribbed') {
            const region = cuffResult.region;
            
            // 填充保护区域
            for (let y = Math.floor(region.y); y < region.y + region.height && y < height; y++) {
                for (let x = Math.floor(region.x); x < region.x + region.width && x < width; x++) {
                    if (x >= 0 && y >= 0) {
                        mask[y * width + x] = 255;
                    }
                }
            }
            
            console.log(`[CuffDetector] 生成保护掩码: ${region.width.toFixed(0)}×${region.height.toFixed(0)} @ (${region.x.toFixed(0)}, ${region.y.toFixed(0)})`);
        }
        
        return mask;
    }
}

/**
 * 快速袜口检测 (简化版)
 * 只基于位置判断，不做复杂分析
 */
export function quickCuffDetection(
    contour: Point2D[],
    imageBounds: BoundingBox
): BoundingBox {
    // 找到轮廓最高点
    let minY = Infinity;
    for (const p of contour) {
        if (p.y < minY) minY = p.y;
    }
    
    // 保护上部 20% 区域
    const protectionHeight = imageBounds.height * 0.2;
    
    return {
        x: imageBounds.x,
        y: minY,
        width: imageBounds.width,
        height: protectionHeight
    };
}
