/**
 * 形态变形工具模块
 * 
 * 将多个不规则形态的产品图片统一为标准形态
 */

// 类型导出
export * from './types';

// 日志系统导出
export * from './execution-logger';

// 工具导出
export { 
    extractShapePath, 
    extractShapePathTool,
    ExtractShapePathParams, 
    ExtractShapePathResult 
} from './shape-extractor';

export { 
    getLayerContour, 
    getLayerContourTool,
    GetLayerContourParams, 
    GetLayerContourResult 
} from './contour-detector';

export { 
    morphToShape,
    batchMorphToShape,
    morphToShapeTool,
    batchMorphToShapeTool,
    MorphToShapeParams, 
    MorphToShapeResult 
} from './morph-executor';

export {
    applyDisplacement,
    applyDisplacementTool,
    ApplyDisplacementParams,
    ApplyDisplacementResult
} from './apply-displacement';

// 工具类导出（用于 ToolRegistry）
export { 
    ExtractShapePathTool, 
    GetLayerContourTool, 
    MorphToShapeTool, 
    BatchMorphToShapeTool 
} from './tool-classes';
