/**
 * 袜子形态统一模块
 * 
 * 专为袜子产品设计的形态调整引擎
 * 
 * 核心特性：
 * 1. 语义分割 - 自动识别袜口/袜身/脚跟/袜趾
 * 2. 骨架对齐 - 使用中轴线对齐而非轮廓强制贴合
 * 3. 分区保护 - 袜口刚性保护，花纹区域低变形
 * 4. 坐标校正 - 处理 Trim 后的坐标偏移
 */

// 主引擎
export { 
  SockMorphEngine, 
  createSockMorphEngine,
  SockMorphRequest,
  SockMorphResult 
} from './sock-morph-engine';

// 坐标转换
export {
  Bounds,
  CoordinateOffset,
  CoordinateTransform,
  calculateTrimOffset,
  transformToTrimmedSpace,
  transformToOriginalSpace,
  transformPointsToTrimmedSpace,
  validateCoordinates
} from './coordinate-transform';

// 骨架/中轴线对齐
export {
  Point,
  Skeleton,
  SkeletonAlignment,
  extractSkeleton,
  alignSkeletons,
  calculateDisplacementField,
  calculateSkeletonSimilarity
} from './skeleton-alignment';

// 语义分割
export {
  SockType,
  SockOrientation,
  SegmentationResult,
  detectSockType,
  detectSockOrientation,
  segmentSock,
  visualizeSegmentation
} from './sock-semantic-segmentation';

// Puppet Warp 服务
export {
  PuppetPin,
  PuppetMeshConfig,
  PuppetWarpConfig,
  SockRegions,
  generatePuppetWarpConfig,
  generateBatchPlayCommand,
  validatePuppetWarpConfig,
  calculateDeformationQuality
} from './puppet-warp-service';

// 集成服务
export {
  SockMorphIntegration,
  createSockMorphIntegration,
  IntegrationConfig,
  WorkflowState
} from './sock-morph-integration';