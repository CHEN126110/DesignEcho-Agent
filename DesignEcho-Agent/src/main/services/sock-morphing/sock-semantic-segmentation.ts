/**
 * 袜子语义分割服务
 * 
 * 功能：自动识别袜子的四个语义区域
 * - 袜口 (Cuff): 顶部边缘区域，需要保持水平
 * - 袜身 (Body): 主体区域，包含花纹
 * - 脚跟 (Heel): 转折区域，允许变形
 * - 袜趾 (Toe): 尖端区域，可自由变形
 */

import { Point } from './skeleton-alignment';
import { SockRegions } from './puppet-warp-service';

/**
 * 袜子类型
 */
export type SockType = 'boat' | 'short' | 'mid' | 'long';

/**
 * 各类型袜子的区域比例
 */
const REGION_RATIOS: Record<SockType, {
  cuff: number;
  body: number;
  heel: number;
  toe: number;
}> = {
  boat:  { cuff: 0.07, body: 0.45, heel: 0.23, toe: 0.25 },
  short: { cuff: 0.12, body: 0.55, heel: 0.18, toe: 0.15 },
  mid:   { cuff: 0.17, body: 0.60, heel: 0.13, toe: 0.10 },
  long:  { cuff: 0.25, body: 0.55, heel: 0.12, toe: 0.08 }
};

/**
 * 袜子方向
 */
export type SockOrientation = 'left' | 'right';

/**
 * 语义分割结果
 */
export interface SegmentationResult {
  sockType: SockType;
  orientation: SockOrientation;
  regions: SockRegions;
  confidence: number;
  // 调试信息
  debug: {
    aspectRatio: number;
    heelConcavity: number;
    cuffHorizontalness: number;
  };
}

/**
 * 检测袜子类型
 * 基于长宽比判断
 */
export function detectSockType(contour: Point[]): SockType {
  const bounds = getContourBounds(contour);
  const aspectRatio = bounds.height / bounds.width;
  
  console.log(`[SockType] 长宽比: ${aspectRatio.toFixed(2)}`);
  
  if (aspectRatio < 1.5) return 'boat';      // 船袜
  if (aspectRatio < 2.5) return 'short';     // 短袜
  if (aspectRatio < 4.0) return 'mid';       // 中筒
  return 'long';                              // 长筒
}

/**
 * 检测袜子方向（左脚/右脚）
 * 基于脚跟凹陷位置判断
 */
export function detectSockOrientation(contour: Point[]): SockOrientation {
  const bounds = getContourBounds(contour);
  const centerX = (bounds.left + bounds.right) / 2;
  
  // 找到轮廓的最大凹陷点（脚跟位置）
  const concavePoint = findMaxConcavePoint(contour);
  
  if (concavePoint) {
    console.log(`[Orientation] 脚跟凹陷点: (${concavePoint.x.toFixed(0)}, ${concavePoint.y.toFixed(0)})`);
    console.log(`[Orientation] 中心X: ${centerX.toFixed(0)}`);
    
    // 凹陷点在右侧 = 左脚袜子
    return concavePoint.x > centerX ? 'left' : 'right';
  }
  
  // 默认
  return 'right';
}

/**
 * 执行语义分割
 */
export function segmentSock(contour: Point[]): SegmentationResult {
  const bounds = getContourBounds(contour);
  const sockType = detectSockType(contour);
  const orientation = detectSockOrientation(contour);
  const ratios = REGION_RATIOS[sockType];
  
  const height = bounds.bottom - bounds.top;
  const width = bounds.right - bounds.left;
  
  // 计算各区域的垂直边界
  let currentY = bounds.top;
  
  // 袜口区域
  const cuffBottom = currentY + height * ratios.cuff;
  const cuffRegion = {
    topY: currentY,
    bottomY: cuffBottom,
    leftX: bounds.left,
    rightX: bounds.right
  };
  currentY = cuffBottom;
  
  // 袜身区域
  const bodyBottom = currentY + height * ratios.body;
  const bodyRegion = {
    topY: currentY,
    bottomY: bodyBottom
  };
  currentY = bodyBottom;
  
  // 脚跟区域（需要特殊处理，因为它是侧向的）
  const heelCenterY = currentY + height * ratios.heel * 0.5;
  const heelRadius = height * ratios.heel * 0.8;
  
  // 根据方向确定脚跟中心 X
  const heelCenterX = orientation === 'left' 
    ? bounds.right - width * 0.25 
    : bounds.left + width * 0.25;
  
  const heelRegion = {
    centerX: heelCenterX,
    centerY: heelCenterY,
    radius: heelRadius
  };
  
  // 袜趾区域
  const toeTop = currentY + height * ratios.heel * 0.3; // 与脚跟有重叠
  const toeRegion = {
    topY: toeTop,
    bottomY: bounds.bottom
  };
  
  // 计算置信度
  const cuffHorizontalness = calculateCuffHorizontalness(contour, cuffRegion.topY, cuffRegion.bottomY);
  const heelConcavity = calculateHeelConcavity(contour, heelRegion);
  const confidence = (cuffHorizontalness + heelConcavity) / 2;
  
  console.log(`[Segmentation] 袜子类型: ${sockType}, 方向: ${orientation}`);
  console.log(`[Segmentation] 袜口水平度: ${(cuffHorizontalness * 100).toFixed(1)}%`);
  console.log(`[Segmentation] 脚跟凹陷度: ${(heelConcavity * 100).toFixed(1)}%`);
  console.log(`[Segmentation] 置信度: ${(confidence * 100).toFixed(1)}%`);
  
  return {
    sockType,
    orientation,
    regions: {
      cuff: cuffRegion,
      body: bodyRegion,
      heel: heelRegion,
      toe: toeRegion
    },
    confidence,
    debug: {
      aspectRatio: height / width,
      heelConcavity,
      cuffHorizontalness
    }
  };
}

/**
 * 获取轮廓边界
 */
function getContourBounds(contour: Point[]): {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
} {
  const xs = contour.map(p => p.x);
  const ys = contour.map(p => p.y);
  
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
}

/**
 * 找到轮廓的最大凹陷点
 * 用于识别脚跟位置
 */
function findMaxConcavePoint(contour: Point[]): Point | null {
  if (contour.length < 10) return null;
  
  let maxConcavity = 0;
  let maxConcavePoint: Point | null = null;
  
  // 使用三点法计算局部凹陷度
  const step = Math.max(1, Math.floor(contour.length / 50));
  
  for (let i = step; i < contour.length - step; i++) {
    const prev = contour[i - step];
    const curr = contour[i];
    const next = contour[i + step];
    
    // 计算从 prev 到 next 的直线到 curr 的距离
    const concavity = pointToLineDistance(curr, prev, next);
    
    // 只考虑凹入的点（向内凹陷）
    if (concavity > maxConcavity && isConvex(prev, curr, next)) {
      maxConcavity = concavity;
      maxConcavePoint = curr;
    }
  }
  
  return maxConcavePoint;
}

/**
 * 计算点到直线的距离
 */
function pointToLineDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) return Math.sqrt(A * A + B * B);
  
  let param = dot / lenSq;
  param = Math.max(0, Math.min(1, param));
  
  const xx = lineStart.x + param * C;
  const yy = lineStart.y + param * D;
  
  const dx = point.x - xx;
  const dy = point.y - yy;
  
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 判断三点是否形成凸角（用于识别凹陷）
 */
function isConvex(p1: Point, p2: Point, p3: Point): boolean {
  const cross = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  return cross > 0; // 根据轮廓方向可能需要调整
}

/**
 * 计算袜口区域的水平度
 * 返回 0-1，1 表示完全水平
 */
function calculateCuffHorizontalness(
  contour: Point[],
  topY: number,
  bottomY: number
): number {
  // 获取袜口区域的轮廓点
  const cuffPoints = contour.filter(p => p.y >= topY && p.y <= bottomY);
  
  if (cuffPoints.length < 3) return 0.5;
  
  // 找到顶部边缘的点
  const minY = Math.min(...cuffPoints.map(p => p.y));
  const topEdgePoints = cuffPoints.filter(p => p.y < minY + (bottomY - topY) * 0.2);
  
  if (topEdgePoints.length < 2) return 0.5;
  
  // 计算 Y 坐标的标准差
  const avgY = topEdgePoints.reduce((sum, p) => sum + p.y, 0) / topEdgePoints.length;
  const variance = topEdgePoints.reduce((sum, p) => sum + (p.y - avgY) ** 2, 0) / topEdgePoints.length;
  const stdDev = Math.sqrt(variance);
  
  // 标准差越小，水平度越高
  const maxStdDev = (bottomY - topY) * 0.5;
  const horizontalness = Math.max(0, 1 - stdDev / maxStdDev);
  
  return horizontalness;
}

/**
 * 计算脚跟区域的凹陷度
 */
function calculateHeelConcavity(
  contour: Point[],
  heel: { centerX: number; centerY: number; radius: number }
): number {
  // 获取脚跟区域附近的轮廓点
  const heelPoints = contour.filter(p => {
    const dx = p.x - heel.centerX;
    const dy = p.y - heel.centerY;
    return Math.sqrt(dx * dx + dy * dy) <= heel.radius * 1.5;
  });
  
  if (heelPoints.length < 3) return 0.5;
  
  // 找到最凹陷的点
  let maxConcavity = 0;
  for (let i = 1; i < heelPoints.length - 1; i++) {
    const concavity = pointToLineDistance(
      heelPoints[i],
      heelPoints[0],
      heelPoints[heelPoints.length - 1]
    );
    maxConcavity = Math.max(maxConcavity, concavity);
  }
  
  // 归一化
  const expectedConcavity = heel.radius * 0.3;
  const normalizedConcavity = Math.min(1, maxConcavity / expectedConcavity);
  
  return normalizedConcavity;
}

/**
 * 可视化分割结果（用于调试）
 * 返回 SVG 路径数据
 */
export function visualizeSegmentation(
  contour: Point[],
  result: SegmentationResult
): string {
  const { regions } = result;
  const bounds = getContourBounds(contour);
  
  let svg = `<svg viewBox="${bounds.left - 10} ${bounds.top - 10} ${bounds.right - bounds.left + 20} ${bounds.bottom - bounds.top + 20}">`;
  
  // 绘制轮廓
  const pathData = contour.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';
  svg += `<path d="${pathData}" fill="none" stroke="black" stroke-width="1"/>`;
  
  // 绘制袜口区域（红色）
  svg += `<rect x="${regions.cuff.leftX}" y="${regions.cuff.topY}" 
          width="${regions.cuff.rightX - regions.cuff.leftX}" 
          height="${regions.cuff.bottomY - regions.cuff.topY}" 
          fill="rgba(255,0,0,0.2)" stroke="red"/>`;
  
  // 绘制袜身区域（绿色）
  svg += `<rect x="${bounds.left}" y="${regions.body.topY}" 
          width="${bounds.right - bounds.left}" 
          height="${regions.body.bottomY - regions.body.topY}" 
          fill="rgba(0,255,0,0.2)" stroke="green"/>`;
  
  // 绘制脚跟区域（蓝色圆形）
  svg += `<circle cx="${regions.heel.centerX}" cy="${regions.heel.centerY}" 
          r="${regions.heel.radius}" 
          fill="rgba(0,0,255,0.2)" stroke="blue"/>`;
  
  // 绘制袜趾区域（黄色）
  svg += `<rect x="${bounds.left}" y="${regions.toe.topY}" 
          width="${bounds.right - bounds.left}" 
          height="${regions.toe.bottomY - regions.toe.topY}" 
          fill="rgba(255,255,0,0.2)" stroke="orange"/>`;
  
  svg += '</svg>';
  
  return svg;
}
