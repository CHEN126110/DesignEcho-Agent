/**
 * 学习视觉案例：把 Agent 学到的设计经验钉在真实参考图上（真实分割标注）。
 *
 * 纯逻辑层（无 ONNX / 无 renderer 依赖，可 smoke）：
 *  - computeSubjectRectFromMask：从抠图蒙版扫出真实主体包围盒 → 归一化矩形（0..1）。
 *  - buildCompositionThirdsLines：三分构图线的归一化坐标，供 UI 叠加。
 *  - normalizeSubjectRect / sanitizeVisualCase：边界钳制与清洗。
 *
 * 真实执行（matting removeBackground 出蒙版）在 main 进程、依赖本机模型——本模块只吃蒙版数据。
 */

/** 归一化矩形（相对图片宽高，0..1）。 */
export interface NormalizedRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type DesignLearningVisualCaseSourceKind = 'project_image' | 'eagle_thumbnail';

/** 学习视觉案例（展示用，不喂给模型）。 */
export interface DesignLearningVisualCase {
    /** 展示用预览图（base64 data URL）。项目图=真实预览；Eagle=缩略图（仅展示给用户，不作模型可见原图）。 */
    previewDataUrl?: string;
    sourceKind: DesignLearningVisualCaseSourceKind;
    /** 真实主体包围盒（来自抠图蒙版），归一化。缺省表示未成功分割——不臆造。 */
    subjectRect?: NormalizedRect;
    /** 展示叠加是否包含三分构图线。 */
    showCompositionGrid?: boolean;
    /** 来源标注文案（如「项目图 · 6252桑蚕丝月子袜」）。 */
    caption?: string;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

/** 把矩形钳制进 [0,1] 且宽高为正；非法则返回 undefined（不臆造）。 */
export function normalizeSubjectRect(rect: NormalizedRect | undefined | null): NormalizedRect | undefined {
    if (!rect) return undefined;
    const x = clamp01(rect.x);
    const y = clamp01(rect.y);
    let w = clamp01(rect.w);
    let h = clamp01(rect.h);
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;
    if (w <= 0 || h <= 0) return undefined;
    return { x, y, w, h };
}

/**
 * 从抠图蒙版扫出主体真实包围盒。
 * mask 为逐像素透明度/前景强度（0..255 或 0..1），按行主序 width*height。
 * alphaThreshold 之上算前景。扫描 min/max 前景像素得像素级 bbox，再归一化。
 * 无前景（全背景/空蒙版）返回 undefined——诚实表示"没分割出主体"，不给假框。
 */
export function computeSubjectRectFromMask(
    mask: ArrayLike<number> | null | undefined,
    width: number,
    height: number,
    alphaThreshold = 24
): NormalizedRect | undefined {
    if (!mask || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return undefined;
    }
    const total = width * height;
    if (mask.length < total) return undefined;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width;
        for (let x = 0; x < width; x++) {
            const value = mask[rowOffset + x];
            // 兼容 0..1 与 0..255 两种量纲
            const alpha = value <= 1 ? value * 255 : value;
            if (alpha >= alphaThreshold) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < minX || maxY < minY) return undefined;

    // bbox 用「像素跨度 = max-min+1」，归一化除以图片尺寸
    const pxW = maxX - minX + 1;
    const pxH = maxY - minY + 1;
    return normalizeSubjectRect({
        x: minX / width,
        y: minY / height,
        w: pxW / width,
        h: pxH / height
    });
}

/** 三分构图线（归一化）：两条竖线 x=1/3,2/3；两条横线 y=1/3,2/3；四个交点=视觉重心候选。 */
export interface CompositionThirds {
    verticals: number[];
    horizontals: number[];
    powerPoints: Array<{ x: number; y: number }>;
}

export function buildCompositionThirdsLines(): CompositionThirds {
    const verticals = [1 / 3, 2 / 3];
    const horizontals = [1 / 3, 2 / 3];
    const powerPoints: Array<{ x: number; y: number }> = [];
    for (const x of verticals) {
        for (const y of horizontals) {
            powerPoints.push({ x, y });
        }
    }
    return { verticals, horizontals, powerPoints };
}

/** 主体覆盖率（%），从归一化框面积算——与断言/学习文案里的「主体占画面」口径一致。 */
export function subjectCoveragePercentFromRect(rect: NormalizedRect | undefined): number | undefined {
    if (!rect) return undefined;
    const pct = rect.w * rect.h * 100;
    return Number.isFinite(pct) ? Math.round(pct) : undefined;
}

/** 清洗视觉案例：钳制矩形、去掉空预览；返回 undefined 表示无可展示内容。 */
export function sanitizeDesignLearningVisualCase(
    raw: DesignLearningVisualCase | undefined | null
): DesignLearningVisualCase | undefined {
    if (!raw) return undefined;
    const previewDataUrl = typeof raw.previewDataUrl === 'string' && raw.previewDataUrl.startsWith('data:')
        ? raw.previewDataUrl
        : undefined;
    const subjectRect = normalizeSubjectRect(raw.subjectRect);
    const sourceKind: DesignLearningVisualCaseSourceKind = raw.sourceKind === 'eagle_thumbnail'
        ? 'eagle_thumbnail'
        : 'project_image';
    // 没有预览图就没有可展示的视觉案例（框/网格无从叠加）
    if (!previewDataUrl) return undefined;
    const caption = typeof raw.caption === 'string' ? raw.caption.trim().slice(0, 80) : undefined;
    const result: DesignLearningVisualCase = { previewDataUrl, sourceKind };
    if (subjectRect) result.subjectRect = subjectRect;
    if (raw.showCompositionGrid) result.showCompositionGrid = true;
    if (caption) result.caption = caption;
    return result;
}
