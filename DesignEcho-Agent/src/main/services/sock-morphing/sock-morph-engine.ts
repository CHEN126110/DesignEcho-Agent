/**
 * 袜子形态统一引擎
 * 
 * 整合所有组件的主服务
 * 
 * 核心流程：
 * 1. 输入验证
 * 2. Trim 并计算坐标偏移
 * 3. 语义分割
 * 4. 骨架提取与对齐
 * 5. 生成 Puppet Warp 配置
 * 6. 执行变形
 * 7. 质量验证
 */

import { Point, Skeleton, extractSkeleton, alignSkeletons, SkeletonAlignment, calculateSkeletonSimilarity } from './skeleton-alignment';
import { Bounds, CoordinateTransform, calculateTrimOffset } from './coordinate-transform';
import { SockType, SockOrientation, SegmentationResult, segmentSock, detectSockType } from './sock-semantic-segmentation';
import { PuppetWarpConfig, generatePuppetWarpConfig, validatePuppetWarpConfig, calculateDeformationQuality, generateBatchPlayCommand } from './puppet-warp-service';

/**
 * 形态统一请求参数
 */
export interface SockMorphRequest {
  // 产品图层信息
  productLayer: {
    id: number;
    name: string;
    bounds: Bounds;
  };
  // 参考形状信息
  referenceShape: {
    id: number;
    name: string;
    contour: Point[];
  };
  // 产品轮廓（从抠图模型获取）
  productContour: Point[];
  // 原始边界（Trim 前）
  originalBounds: Bounds;
  // Trim 后边界
  trimmedBounds: Bounds;
  // 用户设置
  settings: {
    cuffProtection: boolean;      // 是否保护袜口
    patternProtection: boolean;   // 是否保护花纹
    matchIntensity: number;       // 匹配强度 0-100
    sockType?: SockType;          // 手动指定袜子类型
  };
}

/**
 * 形态统一结果
 */
export interface SockMorphResult {
  success: boolean;
  // Puppet Warp 配置（用于 UXP 执行）
  puppetWarpConfig?: PuppetWarpConfig;
  // batchPlay 命令
  batchPlayCommands?: any[];
  // 分析报告
  analysis: {
    sockType: SockType;
    orientation: SockOrientation;
    segmentationConfidence: number;
    skeletonSimilarity: number;
    qualityScore: number;
  };
  // 错误信息
  error?: string;
  // 警告
  warnings: string[];
}

/**
 * 袜子形态统一引擎
 */
export class SockMorphEngine {
  private debug: boolean = true;
  
  constructor(debug: boolean = true) {
    this.debug = debug;
  }
  
  /**
   * 执行形态统一
   */
  async process(request: SockMorphRequest): Promise<SockMorphResult> {
    const warnings: string[] = [];
    
    try {
      this.log('===== 开始袜子形态统一 =====');
      this.log(`产品图层: ${request.productLayer.name} (ID: ${request.productLayer.id})`);
      this.log(`参考形状: ${request.referenceShape.name}`);
      
      // ========== Step 1: 输入验证 ==========
      this.log('\n[Step 1] 输入验证...');
      const validationResult = this.validateInput(request);
      if (!validationResult.valid) {
        return {
          success: false,
          analysis: this.getEmptyAnalysis(),
          error: validationResult.error,
          warnings
        };
      }
      this.log('  ✓ 输入验证通过');
      
      // ========== Step 2: 计算坐标偏移 ==========
      this.log('\n[Step 2] 计算 Trim 坐标偏移...');
      const coordinateTransform = calculateTrimOffset(
        request.originalBounds,
        request.trimmedBounds
      );
      this.log(`  偏移量: (${coordinateTransform.offset.x}, ${coordinateTransform.offset.y})`);
      
      // ========== Step 3: 语义分割 ==========
      this.log('\n[Step 3] 执行语义分割...');
      const segmentation = segmentSock(request.productContour);
      this.log(`  袜子类型: ${segmentation.sockType}`);
      this.log(`  方向: ${segmentation.orientation}`);
      this.log(`  置信度: ${(segmentation.confidence * 100).toFixed(1)}%`);
      
      if (segmentation.confidence < 0.5) {
        warnings.push('语义分割置信度较低，结果可能不准确');
      }
      
      // 如果用户手动指定了袜子类型，覆盖自动检测
      if (request.settings.sockType) {
        this.log(`  用户覆盖袜子类型: ${request.settings.sockType}`);
        (segmentation as any).sockType = request.settings.sockType;
      }
      
      // ========== Step 4: 骨架提取与对齐 ==========
      this.log('\n[Step 4] 骨架提取与对齐...');
      
      const productSkeleton = extractSkeleton(request.productContour, 30);
      this.log(`  产品骨架: ${productSkeleton.points.length} 个点, 长度 ${productSkeleton.length.toFixed(0)}`);
      
      const referenceSkeleton = extractSkeleton(request.referenceShape.contour, 30);
      this.log(`  参考骨架: ${referenceSkeleton.points.length} 个点, 长度 ${referenceSkeleton.length.toFixed(0)}`);
      
      const skeletonAlignment = alignSkeletons(productSkeleton, referenceSkeleton, 20);
      const skeletonSimilarity = calculateSkeletonSimilarity(productSkeleton, referenceSkeleton);
      this.log(`  骨架相似度: ${(skeletonSimilarity * 100).toFixed(1)}%`);
      
      // ========== Step 5: 生成 Puppet Warp 配置 ==========
      this.log('\n[Step 5] 生成 Puppet Warp 配置...');
      
      const puppetWarpConfig = generatePuppetWarpConfig(
        segmentation.regions,
        skeletonAlignment,
        coordinateTransform
      );
      
      // 根据用户设置调整配置
      this.applyUserSettings(puppetWarpConfig, request.settings);
      
      // 验证配置
      const configValidation = validatePuppetWarpConfig(puppetWarpConfig);
      if (!configValidation.valid) {
        this.log('  ✗ 配置验证失败:');
        configValidation.errors.forEach(e => this.log(`    - ${e}`));
        return {
          success: false,
          analysis: this.getEmptyAnalysis(),
          error: configValidation.errors.join('; '),
          warnings
        };
      }
      
      configValidation.warnings.forEach(w => warnings.push(w));
      this.log(`  ✓ 配置生成完成，共 ${puppetWarpConfig.pins.length} 个控制点`);
      
      // ========== Step 6: 生成 batchPlay 命令 ==========
      this.log('\n[Step 6] 生成 batchPlay 命令...');
      const batchPlayCommands = generateBatchPlayCommand(puppetWarpConfig);
      this.log(`  ✓ 生成 ${batchPlayCommands.length} 条命令`);
      
      // ========== Step 7: 质量评估 ==========
      this.log('\n[Step 7] 质量评估...');
      const quality = calculateDeformationQuality(puppetWarpConfig);
      this.log(`  综合评分: ${quality.score.toFixed(1)}`);
      this.log(`  袜口保护: ${quality.details.cuffProtection.toFixed(1)}`);
      this.log(`  花纹保护: ${quality.details.patternPreservation.toFixed(1)}`);
      this.log(`  形状匹配: ${quality.details.shapeMatch.toFixed(1)}`);
      
      this.log('\n===== 形态统一准备完成 =====');
      
      return {
        success: true,
        puppetWarpConfig,
        batchPlayCommands,
        analysis: {
          sockType: segmentation.sockType,
          orientation: segmentation.orientation,
          segmentationConfidence: segmentation.confidence,
          skeletonSimilarity,
          qualityScore: quality.score
        },
        warnings
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`\n✗ 错误: ${errorMsg}`);
      return {
        success: false,
        analysis: this.getEmptyAnalysis(),
        error: errorMsg,
        warnings
      };
    }
  }
  
  /**
   * 验证输入
   */
  private validateInput(request: SockMorphRequest): { valid: boolean; error?: string } {
    // 检查产品轮廓
    if (!request.productContour || request.productContour.length < 10) {
      return { valid: false, error: '产品轮廓点数不足（至少需要 10 个点）' };
    }
    
    // 检查参考形状
    if (!request.referenceShape.contour || request.referenceShape.contour.length < 4) {
      return { valid: false, error: '参考形状轮廓点数不足（至少需要 4 个点）' };
    }
    
    // 检查边界
    if (!request.originalBounds || !request.trimmedBounds) {
      return { valid: false, error: '缺少边界信息' };
    }
    
    // 检查尺寸
    const minSize = 50;
    if (request.trimmedBounds.width < minSize || request.trimmedBounds.height < minSize) {
      return { valid: false, error: `图层尺寸过小（最小 ${minSize}px）` };
    }
    
    return { valid: true };
  }
  
  /**
   * 应用用户设置
   */
  private applyUserSettings(config: PuppetWarpConfig, settings: SockMorphRequest['settings']): void {
    // 袜口保护
    if (!settings.cuffProtection) {
      // 将袜口的静止锚点改为移动锚点
      config.pins
        .filter(p => p.region === 'cuff' && p.type === 'static')
        .forEach(p => {
          p.type = 'moving';
          p.stiffness = 50;
        });
      this.log('  用户禁用袜口保护');
    }
    
    // 花纹保护
    if (!settings.patternProtection) {
      // 降低袜身区域的刚性
      config.pins
        .filter(p => p.region === 'body')
        .forEach(p => {
          p.stiffness = Math.max(20, p.stiffness - 30);
        });
      this.log('  用户降低花纹保护');
    }
    
    // 匹配强度
    const intensityFactor = settings.matchIntensity / 100;
    config.pins
      .filter(p => p.type === 'moving')
      .forEach(p => {
        if (p.targetX !== undefined && p.targetY !== undefined) {
          // 根据强度调整目标位置
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          p.targetX = p.x + dx * intensityFactor;
          p.targetY = p.y + dy * intensityFactor;
        }
      });
    this.log(`  匹配强度: ${settings.matchIntensity}%`);
  }
  
  /**
   * 获取空分析结果
   */
  private getEmptyAnalysis(): SockMorphResult['analysis'] {
    return {
      sockType: 'short',
      orientation: 'right',
      segmentationConfidence: 0,
      skeletonSimilarity: 0,
      qualityScore: 0
    };
  }
  
  /**
   * 日志输出
   */
  private log(message: string): void {
    if (this.debug) {
      console.log(`[SockMorphEngine] ${message}`);
    }
  }
}

/**
 * 创建引擎实例
 */
export function createSockMorphEngine(debug: boolean = true): SockMorphEngine {
  return new SockMorphEngine(debug);
}
