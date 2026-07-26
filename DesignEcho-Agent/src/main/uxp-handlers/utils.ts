/**
 * UXP Handlers 辅助函数
 */

/**
 * 解析多目标输入
 * 支持格式：
 * - "袜子 鞋子" (空格分隔)
 * - "袜子、鞋子" (顿号分隔)
 * - "袜子，鞋子" (逗号分隔)
 * - "袜子,鞋子" (英文逗号分隔)
 * - "袜子|鞋子" (竖线分隔)
 */
export function parseMultiTargets(input: string): string[] {
    if (!input || !input.trim()) return [];
    
    let normalized = input
        .replace(/、/g, ',')
        .replace(/，/g, ',')
        .replace(/\|/g, ',')
        .replace(/\s+/g, ',')
        .replace(/,+/g, ',');
    
    const targets = normalized
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
    
    return [...new Set(targets)];
}

/**
 * 生成矩形轮廓点（沿矩形边缘均匀分布）
 */
export function generateRectContour(
    x: number, 
    y: number, 
    width: number, 
    height: number, 
    pointCount: number
): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [];
    const perimeter = 2 * (width + height);
    const step = perimeter / pointCount;
    
    for (let i = 0; i < pointCount; i++) {
        const dist = i * step;
        
        if (dist < width) {
            points.push({ x: x + dist, y: y });
        } else if (dist < width + height) {
            points.push({ x: x + width, y: y + (dist - width) });
        } else if (dist < 2 * width + height) {
            points.push({ x: x + width - (dist - width - height), y: y + height });
        } else {
            points.push({ x: x, y: y + height - (dist - 2 * width - height) });
        }
    }
    
    return points;
}
