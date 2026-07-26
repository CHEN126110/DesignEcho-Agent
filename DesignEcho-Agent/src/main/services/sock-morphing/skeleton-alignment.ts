/**
 * 骨架/中轴线对齐服务
 * 
 * 核心理念：
 * 不是强制让袜子轮廓贴合参考形状轮廓，
 * 而是让袜子的中轴线对齐参考形状的中轴线。
 * 
 * 优势：
 * 1. 中轴线对齐后，即使边缘有 1-2px 空隙，花纹也不会扭曲
 * 2. 避免了"扇形畸变"问题
 * 3. 更符合人眼的视觉感知
 */

export interface Point {
  x: number;
  y: number;
}

export interface Skeleton {
  // 骨架点序列（从袜口到袜趾）
  points: Point[];
  // 骨架总长度
  length: number;
  // 每个点对应的累积长度（用于参数化）
  cumulativeLengths: number[];
}

export interface SkeletonAlignment {
  // 源骨架（产品袜子）
  sourceSkeleton: Skeleton;
  // 目标骨架（参考形状）
  targetSkeleton: Skeleton;
  // 对应点对
  correspondences: Array<{
    sourcePoint: Point;
    targetPoint: Point;
    t: number; // 参数化位置 [0, 1]
  }>;
}

/**
 * 从轮廓提取中轴线（骨架）
 * 
 * 算法：
 * 1. 对轮廓进行水平切片
 * 2. 每个切片取中点
 * 3. 连接所有中点形成骨架
 */
export function extractSkeleton(contour: Point[], numSlices: number = 50): Skeleton {
  // 1. 获取轮廓的边界
  const minY = Math.min(...contour.map(p => p.y));
  const maxY = Math.max(...contour.map(p => p.y));
  const height = maxY - minY;
  
  const points: Point[] = [];
  const sliceHeight = height / numSlices;
  
  // 2. 对每个切片计算中点
  for (let i = 0; i <= numSlices; i++) {
    const y = minY + i * sliceHeight;
    
    // 找到这个 y 值处轮廓的左右边界
    const intersections = findContourIntersections(contour, y);
    
    if (intersections.length >= 2) {
      // 取最左和最右的交点
      const leftX = Math.min(...intersections.map(p => p.x));
      const rightX = Math.max(...intersections.map(p => p.x));
      
      // 中点
      points.push({
        x: (leftX + rightX) / 2,
        y: y
      });
    }
  }
  
  // 3. 计算骨架长度
  const cumulativeLengths: number[] = [0];
  let totalLength = 0;
  
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);
    totalLength += segmentLength;
    cumulativeLengths.push(totalLength);
  }
  
  console.log(`[SkeletonExtraction] 提取骨架: ${points.length} 个点, 总长度: ${totalLength.toFixed(2)}`);
  
  return {
    points,
    length: totalLength,
    cumulativeLengths
  };
}

/**
 * 找到轮廓与水平线 y 的交点
 */
function findContourIntersections(contour: Point[], y: number): Point[] {
  const intersections: Point[] = [];
  
  for (let i = 0; i < contour.length; i++) {
    const p1 = contour[i];
    const p2 = contour[(i + 1) % contour.length];
    
    // 检查线段是否跨越 y
    if ((p1.y <= y && p2.y >= y) || (p1.y >= y && p2.y <= y)) {
      if (p1.y === p2.y) {
        // 水平线段
        intersections.push({ x: p1.x, y });
        intersections.push({ x: p2.x, y });
      } else {
        // 计算交点 x
        const t = (y - p1.y) / (p2.y - p1.y);
        const x = p1.x + t * (p2.x - p1.x);
        intersections.push({ x, y });
      }
    }
  }
  
  return intersections;
}

/**
 * 对齐两个骨架
 * 
 * 使用参数化方法：
 * 1. 将两个骨架都参数化到 [0, 1]
 * 2. 在等间距的参数位置采样
 * 3. 建立对应关系
 */
export function alignSkeletons(
  sourceSkeleton: Skeleton,
  targetSkeleton: Skeleton,
  numCorrespondences: number = 20
): SkeletonAlignment {
  const correspondences: SkeletonAlignment['correspondences'] = [];
  
  for (let i = 0; i <= numCorrespondences; i++) {
    const t = i / numCorrespondences; // 参数化位置 [0, 1]
    
    const sourcePoint = getPointAtParameter(sourceSkeleton, t);
    const targetPoint = getPointAtParameter(targetSkeleton, t);
    
    correspondences.push({
      sourcePoint,
      targetPoint,
      t
    });
  }
  
  console.log(`[SkeletonAlignment] 建立 ${correspondences.length} 个对应点`);
  
  return {
    sourceSkeleton,
    targetSkeleton,
    correspondences
  };
}

/**
 * 获取骨架在参数 t 处的点
 * t ∈ [0, 1]，0 = 起点，1 = 终点
 */
function getPointAtParameter(skeleton: Skeleton, t: number): Point {
  const targetLength = t * skeleton.length;
  
  // 找到目标长度所在的线段
  for (let i = 0; i < skeleton.cumulativeLengths.length - 1; i++) {
    if (targetLength <= skeleton.cumulativeLengths[i + 1]) {
      const segmentStart = skeleton.cumulativeLengths[i];
      const segmentEnd = skeleton.cumulativeLengths[i + 1];
      const segmentLength = segmentEnd - segmentStart;
      
      if (segmentLength === 0) {
        return skeleton.points[i];
      }
      
      const localT = (targetLength - segmentStart) / segmentLength;
      
      const p1 = skeleton.points[i];
      const p2 = skeleton.points[i + 1];
      
      return {
        x: p1.x + localT * (p2.x - p1.x),
        y: p1.y + localT * (p2.y - p1.y)
      };
    }
  }
  
  // 返回最后一个点
  return skeleton.points[skeleton.points.length - 1];
}

/**
 * 计算骨架对齐的位移场
 * 用于指导 Puppet Warp 的控制点移动
 */
export function calculateDisplacementField(
  alignment: SkeletonAlignment
): Array<{ source: Point; target: Point; displacement: Point }> {
  return alignment.correspondences.map(corr => ({
    source: corr.sourcePoint,
    target: corr.targetPoint,
    displacement: {
      x: corr.targetPoint.x - corr.sourcePoint.x,
      y: corr.targetPoint.y - corr.sourcePoint.y
    }
  }));
}

/**
 * 评估两个骨架的相似度
 */
export function calculateSkeletonSimilarity(
  skeleton1: Skeleton,
  skeleton2: Skeleton
): number {
  // 使用 Procrustes 分析或简单的均方误差
  const alignment = alignSkeletons(skeleton1, skeleton2, 50);
  
  let totalError = 0;
  for (const corr of alignment.correspondences) {
    const dx = corr.targetPoint.x - corr.sourcePoint.x;
    const dy = corr.targetPoint.y - corr.sourcePoint.y;
    totalError += Math.sqrt(dx * dx + dy * dy);
  }
  
  const avgError = totalError / alignment.correspondences.length;
  
  // 归一化到 [0, 1]，误差越小，相似度越高
  const normalizedError = avgError / Math.max(skeleton1.length, skeleton2.length);
  const similarity = Math.max(0, 1 - normalizedError);
  
  return similarity;
}
