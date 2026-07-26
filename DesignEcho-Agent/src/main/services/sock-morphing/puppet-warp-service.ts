/**
 * Puppet Warp 服务
 * 
 * 核心理念：整体变形 + 局部刚性约束
 * 
 * 关键改进（来自专业审查）：
 * 1. 不切割图层，始终保持袜子是一个完整的图层
 * 2. 语义分割结果只作为 Puppet Warp 的权重参考
 * 3. 通过在袜口周围打密集的"静止锚点"实现局部保护
 * 4. 使用中轴线对齐而非轮廓强制贴合
 */

import { Point, Skeleton, SkeletonAlignment } from './skeleton-alignment';
import { CoordinateTransform, transformToTrimmedSpace } from './coordinate-transform';

/**
 * Puppet Warp 控制点类型
 */
export interface PuppetPin {
  // 位置
  x: number;
  y: number;
  // 类型：静止点（刚性）或移动点（柔性）
  type: 'static' | 'moving';
  // 目标位置（仅对 moving 类型有效）
  targetX?: number;
  targetY?: number;
  // 所属区域
  region: 'cuff' | 'body' | 'heel' | 'toe';
  // 刚性程度 (0-100)
  stiffness: number;
  // 旋转角度（度）
  rotation: number;
  // 深度（用于重叠处理）
  depth: number;
}

/**
 * Puppet Warp 网格配置
 */
export interface PuppetMeshConfig {
  // 网格密度：更多三角形 = 更精细的变形
  density: 'fewer' | 'normal' | 'more';
  // 扩展：网格边缘超出图层边界的距离
  expansion: 'normal' | 'rigid' | 'distort';
  // 模式
  mode: 'normal' | 'rigid' | 'distort';
}

/**
 * Puppet Warp 完整配置
 */
export interface PuppetWarpConfig {
  // 控制点列表
  pins: PuppetPin[];
  // 网格配置
  mesh: PuppetMeshConfig;
  // 坐标转换（处理 Trim 后的偏移）
  coordinateTransform?: CoordinateTransform;
}

/**
 * 语义区域定义
 */
export interface SockRegions {
  cuff: {
    topY: number;
    bottomY: number;
    leftX: number;
    rightX: number;
  };
  body: {
    topY: number;
    bottomY: number;
  };
  heel: {
    centerX: number;
    centerY: number;
    radius: number;
  };
  toe: {
    topY: number;
    bottomY: number;
  };
}

/**
 * 生成 Puppet Warp 配置
 * 
 * 策略：
 * 1. 在袜口区域打密集的静止锚点（6-8个）
 * 2. 在袜身区域沿中轴线打少量控制点
 * 3. 在袜跟和袜趾打移动锚点
 */
export function generatePuppetWarpConfig(
  regions: SockRegions,
  skeletonAlignment: SkeletonAlignment,
  coordinateTransform?: CoordinateTransform
): PuppetWarpConfig {
  const pins: PuppetPin[] = [];
  
  // ========== 1. 袜口区域：密集静止锚点 ==========
  const cuffPins = generateCuffPins(regions.cuff);
  pins.push(...cuffPins);
  console.log(`[PuppetWarp] 袜口区域: ${cuffPins.length} 个静止锚点`);
  
  // ========== 2. 袜身区域：沿中轴线的控制点 ==========
  const bodyPins = generateBodyPins(regions.body, skeletonAlignment);
  pins.push(...bodyPins);
  console.log(`[PuppetWarp] 袜身区域: ${bodyPins.length} 个控制点`);
  
  // ========== 3. 袜跟区域：移动锚点 ==========
  const heelPins = generateHeelPins(regions.heel, skeletonAlignment);
  pins.push(...heelPins);
  console.log(`[PuppetWarp] 袜跟区域: ${heelPins.length} 个移动锚点`);
  
  // ========== 4. 袜趾区域：移动锚点 ==========
  const toePins = generateToePins(regions.toe, skeletonAlignment);
  pins.push(...toePins);
  console.log(`[PuppetWarp] 袜趾区域: ${toePins.length} 个移动锚点`);
  
  // 如果有坐标转换，应用到所有点
  if (coordinateTransform) {
    for (const pin of pins) {
      const transformed = transformToTrimmedSpace({ x: pin.x, y: pin.y }, coordinateTransform);
      pin.x = transformed.x;
      pin.y = transformed.y;
      
      if (pin.targetX !== undefined && pin.targetY !== undefined) {
        const transformedTarget = transformToTrimmedSpace(
          { x: pin.targetX, y: pin.targetY }, 
          coordinateTransform
        );
        pin.targetX = transformedTarget.x;
        pin.targetY = transformedTarget.y;
      }
    }
    console.log(`[PuppetWarp] 已应用坐标转换（Trim偏移）`);
  }
  
  return {
    pins,
    mesh: {
      density: 'more',      // 更密的网格以获得更精细的变形
      expansion: 'normal',
      mode: 'rigid'         // 刚性模式，保护花纹
    },
    coordinateTransform
  };
}

/**
 * 生成袜口区域的静止锚点
 * 
 * 策略：沿袜口边缘均匀分布 6-8 个点
 * 这些点完全不动，确保袜口保持原状
 */
function generateCuffPins(cuff: SockRegions['cuff']): PuppetPin[] {
  const pins: PuppetPin[] = [];
  const numPins = 6; // 袜口锚点数量
  
  const width = cuff.rightX - cuff.leftX;
  const height = cuff.bottomY - cuff.topY;
  
  // 顶部边缘：3个点
  for (let i = 0; i < 3; i++) {
    const x = cuff.leftX + (width / 4) * (i + 1);
    pins.push({
      x,
      y: cuff.topY + height * 0.1,
      type: 'static',
      region: 'cuff',
      stiffness: 100,  // 完全刚性
      rotation: 0,
      depth: 0
    });
  }
  
  // 底部边缘：3个点
  for (let i = 0; i < 3; i++) {
    const x = cuff.leftX + (width / 4) * (i + 1);
    pins.push({
      x,
      y: cuff.bottomY - height * 0.1,
      type: 'static',
      region: 'cuff',
      stiffness: 100,
      rotation: 0,
      depth: 0
    });
  }
  
  return pins;
}

/**
 * 生成袜身区域的控制点
 * 
 * 策略：沿中轴线分布，允许轻微移动以适应形状
 */
function generateBodyPins(
  body: SockRegions['body'],
  alignment: SkeletonAlignment
): PuppetPin[] {
  const pins: PuppetPin[] = [];
  
  // 从骨架对齐中获取袜身区域的对应点
  const bodyCorrespondences = alignment.correspondences.filter(corr => {
    const y = corr.sourcePoint.y;
    return y >= body.topY && y <= body.bottomY;
  });
  
  // 选取部分点作为控制点（不要太密）
  const step = Math.max(1, Math.floor(bodyCorrespondences.length / 5));
  
  for (let i = 0; i < bodyCorrespondences.length; i += step) {
    const corr = bodyCorrespondences[i];
    
    // 袜身的点是"半刚性"的：有目标位置，但刚性度较高
    pins.push({
      x: corr.sourcePoint.x,
      y: corr.sourcePoint.y,
      type: 'moving',
      targetX: corr.targetPoint.x,
      targetY: corr.targetPoint.y,
      region: 'body',
      stiffness: 70,  // 较高刚性，保护花纹
      rotation: 0,
      depth: 1
    });
  }
  
  return pins;
}

/**
 * 生成袜跟区域的移动锚点
 */
function generateHeelPins(
  heel: SockRegions['heel'],
  alignment: SkeletonAlignment
): PuppetPin[] {
  const pins: PuppetPin[] = [];
  
  // 脚跟区域的对应点
  const heelCorrespondences = alignment.correspondences.filter(corr => {
    const dx = corr.sourcePoint.x - heel.centerX;
    const dy = corr.sourcePoint.y - heel.centerY;
    return Math.sqrt(dx * dx + dy * dy) <= heel.radius;
  });
  
  // 脚跟区域允许较大变形
  for (const corr of heelCorrespondences) {
    pins.push({
      x: corr.sourcePoint.x,
      y: corr.sourcePoint.y,
      type: 'moving',
      targetX: corr.targetPoint.x,
      targetY: corr.targetPoint.y,
      region: 'heel',
      stiffness: 30,  // 较低刚性，允许变形
      rotation: 0,
      depth: 2
    });
  }
  
  return pins;
}

/**
 * 生成袜趾区域的移动锚点
 */
function generateToePins(
  toe: SockRegions['toe'],
  alignment: SkeletonAlignment
): PuppetPin[] {
  const pins: PuppetPin[] = [];
  
  // 袜趾区域的对应点
  const toeCorrespondences = alignment.correspondences.filter(corr => {
    const y = corr.sourcePoint.y;
    return y >= toe.topY && y <= toe.bottomY;
  });
  
  // 袜趾区域允许最大变形
  for (const corr of toeCorrespondences) {
    pins.push({
      x: corr.sourcePoint.x,
      y: corr.sourcePoint.y,
      type: 'moving',
      targetX: corr.targetPoint.x,
      targetY: corr.targetPoint.y,
      region: 'toe',
      stiffness: 20,  // 最低刚性，自由变形
      rotation: 0,
      depth: 3
    });
  }
  
  return pins;
}

/**
 * 生成 Photoshop batchPlay 命令
 * 
 * 注意：Puppet Warp 在 UXP 中通过 batchPlay 调用
 */
export function generateBatchPlayCommand(config: PuppetWarpConfig): any[] {
  const commands: any[] = [];
  
  // 1. 开始 Puppet Warp
  commands.push({
    _obj: 'puppetWarp',
    meshFidelity: config.mesh.density === 'more' ? 2 : 
                  config.mesh.density === 'normal' ? 1 : 0,
    meshExpansion: config.mesh.expansion === 'rigid' ? 1 : 
                   config.mesh.expansion === 'distort' ? 2 : 0,
    meshRotation: 0,
    _options: {
      dialogOptions: 'dontDisplay'
    }
  });
  
  // 2. 添加控制点
  for (const pin of config.pins) {
    commands.push({
      _obj: 'puppetWarpPin',
      puppetPinLocation: {
        _obj: 'point',
        horizontal: pin.x,
        vertical: pin.y
      },
      puppetPinRotation: pin.rotation,
      puppetPinDepth: pin.depth,
      puppetPinStiffness: pin.stiffness,
      _options: {
        dialogOptions: 'dontDisplay'
      }
    });
    
    // 如果是移动点，添加移动命令
    if (pin.type === 'moving' && pin.targetX !== undefined && pin.targetY !== undefined) {
      commands.push({
        _obj: 'puppetWarpPinMove',
        to: {
          _obj: 'point',
          horizontal: pin.targetX,
          vertical: pin.targetY
        },
        _options: {
          dialogOptions: 'dontDisplay'
        }
      });
    }
  }
  
  // 3. 应用变形
  commands.push({
    _obj: 'applyPuppetWarp',
    _options: {
      dialogOptions: 'dontDisplay'
    }
  });
  
  return commands;
}

/**
 * 验证 Puppet Warp 配置的有效性
 */
export function validatePuppetWarpConfig(config: PuppetWarpConfig): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 检查是否有足够的静止锚点
  const staticPins = config.pins.filter(p => p.type === 'static');
  if (staticPins.length < 3) {
    errors.push('静止锚点不足 3 个，袜口保护可能失效');
  }
  
  // 检查是否有移动锚点
  const movingPins = config.pins.filter(p => p.type === 'moving');
  if (movingPins.length === 0) {
    warnings.push('没有移动锚点，图层将不会变形');
  }
  
  // 检查坐标有效性
  for (const pin of config.pins) {
    if (pin.x < 0 || pin.y < 0) {
      errors.push(`控制点坐标无效: (${pin.x}, ${pin.y})`);
    }
  }
  
  // 检查刚性值范围
  for (const pin of config.pins) {
    if (pin.stiffness < 0 || pin.stiffness > 100) {
      warnings.push(`刚性值超出范围 [0-100]: ${pin.stiffness}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * 计算变形质量评分
 */
export function calculateDeformationQuality(config: PuppetWarpConfig): {
  score: number;
  details: {
    cuffProtection: number;
    patternPreservation: number;
    shapeMatch: number;
  };
} {
  // 袜口保护评分（静止锚点数量和分布）
  const cuffPins = config.pins.filter(p => p.region === 'cuff' && p.type === 'static');
  const cuffProtection = Math.min(100, cuffPins.length * 15);
  
  // 花纹保护评分（袜身区域的平均刚性）
  const bodyPins = config.pins.filter(p => p.region === 'body');
  const avgBodyStiffness = bodyPins.length > 0
    ? bodyPins.reduce((sum, p) => sum + p.stiffness, 0) / bodyPins.length
    : 50;
  const patternPreservation = avgBodyStiffness;
  
  // 形状匹配评分（移动锚点的覆盖度）
  const movingPins = config.pins.filter(p => p.type === 'moving');
  const shapeMatch = Math.min(100, movingPins.length * 10);
  
  // 综合评分
  const score = (cuffProtection * 0.4 + patternPreservation * 0.35 + shapeMatch * 0.25);
  
  return {
    score,
    details: {
      cuffProtection,
      patternPreservation,
      shapeMatch
    }
  };
}
