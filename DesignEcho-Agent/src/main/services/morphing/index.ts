/**
 * 形态变形服务模块
 * 
 * 提供图像变形计算能力
 */

// 核心服务
export { MorphingService, getMorphingService } from './morphing-service';
export { DistanceFieldCalculator } from './distance-field';
export { MLSDeformation } from './mls-deformation';
export { ContentAnalyzer } from './content-analyzer';

// 优化算法
export { JFADistanceField, BruteForceDistanceField, testJFAPrecision } from './jfa-distance-field';
export { 
    compressDisplacementField, 
    decompressDisplacementField,
    serializeSparseDisplacement,
    deserializeSparseDisplacement,
    validateSparseDisplacement,
    getCompressionStats
} from './sparse-displacement';
export { SmartCuffDetector, quickCuffDetection } from './smart-cuff-detector';

// 优化服务
export { 
    OptimizedMorphingService, 
    getOptimizedMorphingService 
} from './optimized-morphing-service';
export type { 
    OptimizedMorphRequest, 
    OptimizedMorphResult 
} from './optimized-morphing-service';

// 增强功能 - 袜子形态统一
export { SockRegionAnalyzer, getSockRegionAnalyzer } from './sock-region-analyzer';
export type { 
    SockRegions, 
    SockRegion, 
    KeyPoint, 
    CuffType, 
    CuffAnalysisResult, 
    SockAnalysisResult 
} from './sock-region-analyzer';

export { RegionAwareMatcher, getRegionAwareMatcher, DEFAULT_MATCHER_CONFIG } from './region-aware-matcher';
export type { MatcherConfig, MatchingResult } from './region-aware-matcher';

export { EnhancedMorphExecutor, getEnhancedMorphExecutor, DEFAULT_ENHANCED_CONFIG } from './enhanced-morph-executor';
export type { EnhancedMorphConfig, EnhancedMorphResult } from './enhanced-morph-executor';

export { ImageWarper, getImageWarper } from './image-warper';
export type { WarpImageParams, WarpImageResult } from './image-warper';

// 类型定义
export * from './types';
