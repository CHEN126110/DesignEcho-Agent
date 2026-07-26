/**
 * 形态变形服务类型定义
 */

// 2D 点
export interface Point2D {
    x: number;
    y: number;
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
    rotation: number;
}

// 控制点对
export interface ControlPointPair {
    source: Point2D;
    target: Point2D;
    weight: number;
}

// 位移场
export interface DisplacementField {
    width: number;
    height: number;
    dx: Float32Array;  // X 方向位移
    dy: Float32Array;  // Y 方向位移
}

/**
 * 稀疏位移场 - 只存储边缘带像素
 * 用于减少传输数据量
 */
export interface SparseDisplacementField {
    width: number;
    height: number;
    
    // 边缘带像素数
    pixelCount: number;
    
    // 像素索引 (y * width + x)
    indices: Uint32Array;
    
    // 位移 (量化为 Int16, 实际值 = 存储值 / 100)
    dx: Int16Array;
    dy: Int16Array;
    
    // 校验和
    checksum: number;
}

/**
 * 袜口类型
 */
export type CuffType = 'plain' | 'lace' | 'double' | 'ribbed' | 'unknown';

/**
 * 袜口检测结果
 */
export interface CuffDetectionResult {
    type: CuffType;
    region: BoundingBox;
    confidence: number;
    protectionMask?: Uint8Array;
    features: {
        position: number;      // 位置得分
        complexity: number;    // 边缘复杂度
        symmetry: number;      // 对称性
    };
}

// 变形配置
export interface MorphingConfig {
    // 边缘带设置
    edgeBandWidth: number;
    transitionWidth: number;
    
    // 内容保护
    detectPatterns: boolean;
    detectLace: boolean;
    patternProtection: number;
    
    // 质量设置
    qualityPreset: 'fast' | 'balanced' | 'quality';
    
    // 网格设置
    gridSize: number;
    
    // 变形 pass 数量
    morphPasses: number;
}

// 内容分析结果
export interface ContentAnalysisResult {
    // 图案检测
    hasPattern: boolean;
    patternMask: Uint8Array | null;
    patternComplexity: number;
    
    // 花边检测
    hasLace: boolean;
    laceRegion: BoundingBox | null;
    laceConfidence: number;
    
    // 区域分割
    regions: {
        cuff: BoundingBox | null;   // 袜口
        body: BoundingBox | null;   // 袜身
        toe: BoundingBox | null;    // 袜尖
    };
}

// 变形请求
export interface MorphRequest {
    sourceImageBase64: string;
    sourceContour: Point2D[];
    targetContour: Point2D[];
    config: MorphingConfig;
    alignment?: AlignmentTransform;
}

// 变形结果
export interface MorphResult {
    success: boolean;
    morphedImageBase64?: string;     // RGBA 格式（用于 UXP 应用）- 已弃用，使用分块获取
    morphedImagePng?: string;        // PNG 格式（用于预览/调试）
    
    // 分块传输支持（解决 WebSocket 大消息问题）
    resultId?: string;               // 用于分块获取的结果 ID
    width?: number;                  // 图像宽度
    height?: number;                 // 图像高度
    dataSize?: number;               // 数据大小（字节）
    
    displacementField?: DisplacementField;
    contentAnalysis?: ContentAnalysisResult;
    processingTime: number;
    error?: string;
    
    // 性能统计
    stats?: {
        distanceFieldTime: number;
        contentAnalysisTime: number;
        mlsTime: number;
        warpTime: number;
    };
}

// 日志条目
export interface MorphingLogEntry {
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error' | 'perf';
    step: string;
    message: string;
    data?: any;
    duration?: number;
}

// 默认配置
export const DEFAULT_MORPHING_CONFIG: MorphingConfig = {
    edgeBandWidth: 50,
    transitionWidth: 30,
    detectPatterns: true,
    detectLace: true,
    patternProtection: 0.8,
    qualityPreset: 'balanced',
    gridSize: 50,
    morphPasses: 2
};

// 质量预设
export const QUALITY_PRESETS: Record<string, Partial<MorphingConfig>> = {
    fast: {
        gridSize: 100,
        morphPasses: 1
    },
    balanced: {
        gridSize: 50,
        morphPasses: 2
    },
    quality: {
        gridSize: 25,
        morphPasses: 3
    }
};
