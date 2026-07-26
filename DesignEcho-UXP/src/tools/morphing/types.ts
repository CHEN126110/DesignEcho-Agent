/**
 * 形态变形工具类型定义
 */

// 2D 点
export interface Point2D {
    x: number;
    y: number;
}

// 贝塞尔曲线点
export interface BezierPoint {
    anchor: Point2D;           // 锚点
    leftDirection?: Point2D;   // 左控制柄
    rightDirection?: Point2D;  // 右控制柄
}

// 路径数据
export interface PathData {
    points: BezierPoint[];
    closed: boolean;
}

// 形状轮廓
export interface ShapeContour {
    layerId: number;
    layerName: string;
    paths: PathData[];
    boundingBox: BoundingBox;
    centroid: Point2D;
    area: number;
}

// 边界框
export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

// 对齐变换
export interface AlignmentTransform {
    translation: Point2D;
    scale: Point2D;
    rotation: number;  // 弧度
}

// 变形配置
export interface MorphingConfig {
    // 边缘带设置
    edgeBandWidth: number;        // 边缘带宽度（像素），默认 50
    transitionWidth: number;      // 过渡区宽度（像素），默认 30
    
    // 内容保护
    detectPatterns: boolean;      // 自动检测图案
    detectLace: boolean;          // 自动检测花边
    patternProtection: number;    // 图案保护强度 0-1
    
    // 对齐方式
    alignmentMethod: 'centroid' | 'boundingBox' | 'auto';
    
    // 质量设置
    qualityPreset: 'fast' | 'balanced' | 'quality';
}

// 内容分析结果
export interface ContentAnalysisResult {
    hasPattern: boolean;
    patternRegions: BoundingBox[];
    hasLace: boolean;
    laceRegion?: BoundingBox;
    laceConfidence: number;
}

// 变形结果
export interface MorphResult {
    success: boolean;
    layerId: number;
    layerName: string;
    processingTime: number;  // 毫秒
    error?: string;
    details?: {
        alignmentApplied: AlignmentTransform;
        /** 真实形状变形是否已执行。当前 UXP 侧只应用对齐变换，变形需 Agent 管线。 */
        morphApplied: boolean;
        /** 对结果范围的诚实说明（例如：只应用了对齐预览，未变形）。 */
        note: string;
        shapeDifference: number;  // 0-1
    };
}

// 批量变形任务
export interface BatchMorphTask {
    targetShapeLayerId: number;
    productLayerIds: number[];
    config: MorphingConfig;
}

// 批量变形结果
export interface BatchMorphResult {
    success: boolean;
    totalLayers: number;
    successCount: number;
    failedCount: number;
    results: MorphResult[];
    totalTime: number;
}
