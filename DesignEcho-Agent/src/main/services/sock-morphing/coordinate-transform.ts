/**
 * 坐标转换服务
 * 处理 Trim 操作后的坐标空间变换
 */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface CoordinateOffset {
  x: number;
  y: number;
}

export interface CoordinateTransform {
  // Trim 前的边界
  originalBounds: Bounds;
  // Trim 后的边界
  trimmedBounds: Bounds;
  // 偏移量（用于将原始坐标转换为 Trim 后的坐标）
  offset: CoordinateOffset;
  // 缩放比例（如果有缩放）
  scale: { x: number; y: number };
}

/**
 * 计算 Trim 后的坐标偏移
 * 
 * 使用场景：
 * 1. 原始图层边界：(100, 200, 500, 600)
 * 2. 执行 Trim 后，图层移动到：(0, 0, 400, 400)
 * 3. 语义分割在原始坐标中识别袜口位置：(150, 220)
 * 4. 需要转换为 Trim 后的坐标：(150-100, 220-200) = (50, 20)
 */
export function calculateTrimOffset(
  originalBounds: Bounds,
  trimmedBounds: Bounds
): CoordinateTransform {
  // 计算偏移量
  // 原始坐标 - offset = Trim 后坐标
  const offset: CoordinateOffset = {
    x: originalBounds.left - trimmedBounds.left,
    y: originalBounds.top - trimmedBounds.top
  };

  // 计算缩放比例（通常 Trim 不会缩放，但需要考虑后续操作）
  const scale = {
    x: trimmedBounds.width / originalBounds.width,
    y: trimmedBounds.height / originalBounds.height
  };

  console.log('[CoordinateTransform] 坐标偏移计算:');
  console.log(`  原始边界: (${originalBounds.left}, ${originalBounds.top}) - (${originalBounds.right}, ${originalBounds.bottom})`);
  console.log(`  Trim后边界: (${trimmedBounds.left}, ${trimmedBounds.top}) - (${trimmedBounds.right}, ${trimmedBounds.bottom})`);
  console.log(`  偏移量: (${offset.x}, ${offset.y})`);

  return {
    originalBounds,
    trimmedBounds,
    offset,
    scale
  };
}

/**
 * 将原始坐标转换为 Trim 后的坐标
 */
export function transformToTrimmedSpace(
  point: { x: number; y: number },
  transform: CoordinateTransform
): { x: number; y: number } {
  return {
    x: (point.x - transform.offset.x) * transform.scale.x,
    y: (point.y - transform.offset.y) * transform.scale.y
  };
}

/**
 * 将 Trim 后的坐标转换回原始坐标
 */
export function transformToOriginalSpace(
  point: { x: number; y: number },
  transform: CoordinateTransform
): { x: number; y: number } {
  return {
    x: point.x / transform.scale.x + transform.offset.x,
    y: point.y / transform.scale.y + transform.offset.y
  };
}

/**
 * 批量转换点坐标
 */
export function transformPointsToTrimmedSpace(
  points: Array<{ x: number; y: number }>,
  transform: CoordinateTransform
): Array<{ x: number; y: number }> {
  return points.map(p => transformToTrimmedSpace(p, transform));
}

/**
 * 验证坐标是否在有效范围内
 */
export function validateCoordinates(
  point: { x: number; y: number },
  bounds: Bounds
): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= bounds.width &&
    point.y <= bounds.height
  );
}
