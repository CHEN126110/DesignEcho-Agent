/**
 * 画面测量提取器（design quality measurement）—— 把"画面结构"换算成断言评分要的真实测量值。
 *
 * 衔接：上一层 [design-quality-assertion.ts] 的确定性断言要 DesignQualityMeasurements 才能打分；
 * 本模块从一份归一化的"画面快照结构"（DesignSurfaceSnapshot，来自 getLayerHierarchy /
 * getAllTextLayers / getLayerBounds / getDocumentInfo 等现有工具的结构化结果）确定性地算出这些测量值。
 *
 * 关键纪律（与项目一致）：
 * - 纯逻辑：只做几何/结构计算，不调模型、不读像素、不触发 IPC、不依赖运行环境（可被 smoke 直接测）。
 * - 算得出的才给；算不出的（如需真实像素的"主体—背景对比度"）**诚实留 undefined**，让上游判 uneval，
 *   绝不补默认值伪造"已测量"。
 * - 不做意图猜测、不读文件名——只看画面里客观存在的图层几何与属性（理解优于硬编码的实践）。
 */

import type { DesignQualityMeasurements } from './design-quality-assertion';

export type SurfaceLayerKind = 'image' | 'text' | 'shape' | 'background' | 'group' | 'other';

export interface SurfaceRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SurfaceRgb {
    r: number;
    g: number;
    b: number;
}

/** 画面里的一个图层（已从工具结果归一化）。字段尽量宽松可选，缺什么就少算什么。 */
export interface SurfaceLayer {
    id?: string;
    kind: SurfaceLayerKind;
    /** 像素，画布坐标系 */
    bounds?: SurfaceRect;
    /** 是否主视觉主体（产品/模特图）。由上游素材角色判断填入，本模块不猜 */
    isSubject?: boolean;
    /** 文本图层字号（pt 或 px，相对比较用） */
    fontSize?: number;
    /** 文本对齐 */
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    /** shape/background 的填充色（0..255） */
    fillColor?: SurfaceRgb;
    /** 默认可见（仅 visible===false 视为隐藏） */
    visible?: boolean;
}

export interface DesignSurfaceSnapshot {
    canvas: { width: number; height: number };
    layers: SurfaceLayer[];
}

function isVisible(layer: SurfaceLayer): boolean {
    return layer.visible !== false;
}

function hasValidBounds(layer: SurfaceLayer): boolean {
    const b = layer.bounds;
    return Boolean(b) && Number.isFinite(b!.width) && Number.isFinite(b!.height) && b!.width > 0 && b!.height > 0;
}

/** 内容图层 = 可见、非 group、非 background（参与构图/对齐/计数的实体元素）。 */
function isContentLayer(layer: SurfaceLayer): boolean {
    return isVisible(layer) && layer.kind !== 'group' && layer.kind !== 'background';
}

function canvasArea(snapshot: DesignSurfaceSnapshot): number {
    const { width, height } = snapshot.canvas || { width: 0, height: 0 };
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width * height : 0;
}

/** 对齐/越界判断容差：画布短边的 1%，至少 4px。 */
function tolerance(snapshot: DesignSurfaceSnapshot): number {
    const shortSide = Math.min(snapshot.canvas?.width || 0, snapshot.canvas?.height || 0);
    return Math.max(4, shortSide * 0.01);
}

function computeSubjectAreaRatio(snapshot: DesignSurfaceSnapshot): number | undefined {
    const area = canvasArea(snapshot);
    if (area <= 0) return undefined;
    const subjects = snapshot.layers.filter((l) => isVisible(l) && l.isSubject && hasValidBounds(l));
    if (subjects.length === 0) return undefined;
    //  取最大主体（多主体时以最显著者代表识别度）
    const maxArea = Math.max(...subjects.map((l) => l.bounds!.width * l.bounds!.height));
    return Math.min(1, maxArea / area);
}

function computeElementCount(snapshot: DesignSurfaceSnapshot): number {
    return snapshot.layers.filter(isContentLayer).length;
}

function computeHasOverflow(snapshot: DesignSurfaceSnapshot): boolean | undefined {
    const { width, height } = snapshot.canvas || {};
    if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) return undefined;
    const located = snapshot.layers.filter((l) => isContentLayer(l) && hasValidBounds(l));
    if (located.length === 0) return undefined;
    const tol = tolerance(snapshot);
    return located.some((l) => {
        const b = l.bounds!;
        return b.x < -tol || b.y < -tol || (b.x + b.width) > width! + tol || (b.y + b.height) > height! + tol;
    });
}

function computeTitleToSubtitleScale(snapshot: DesignSurfaceSnapshot): number | undefined {
    const sizes = snapshot.layers
        .filter((l) => isVisible(l) && l.kind === 'text' && Number.isFinite(l.fontSize) && (l.fontSize as number) > 0)
        .map((l) => l.fontSize as number)
        .sort((a, b) => b - a);
    if (sizes.length < 2) return undefined;
    const [largest, second] = sizes;
    if (second <= 0) return undefined;
    return largest / second;
}

/**
 * 对齐分：内容图层在 6 条对齐线（left/centerX/right/top/centerY/bottom）上，与其它图层共享同一对齐线
 * （容差内）即视为"对齐"。返回对齐图层占比 0..1。需 ≥2 个带 bounds 的内容图层。
 */
function computeAlignmentScore(snapshot: DesignSurfaceSnapshot): number | undefined {
    const located = snapshot.layers.filter((l) => isContentLayer(l) && hasValidBounds(l));
    if (located.length < 2) return undefined;
    const tol = tolerance(snapshot);

    const lineValues = (b: SurfaceRect): number[] => [
        b.x,                       // left
        b.x + b.width / 2,         // centerX
        b.x + b.width,             // right
        b.y,                       // top
        b.y + b.height / 2,        // centerY
        b.y + b.height             // bottom
    ];

    const alignedFlags = located.map(() => false);
    for (let dimension = 0; dimension < 6; dimension++) {
        const values = located.map((l) => lineValues(l.bounds!)[dimension]);
        for (let i = 0; i < located.length; i++) {
            for (let j = i + 1; j < located.length; j++) {
                if (Math.abs(values[i] - values[j]) <= tol) {
                    alignedFlags[i] = true;
                    alignedFlags[j] = true;
                }
            }
        }
    }
    const alignedCount = alignedFlags.filter(Boolean).length;
    return alignedCount / located.length;
}

function isNearWhite(color: SurfaceRgb | undefined): boolean {
    if (!color) return false;
    return color.r >= 240 && color.g >= 240 && color.b >= 240;
}

/**
 * 背景是否为"省事的默认白底/未设计"：
 * - 没有任何 background 图层 → true（画布默认白底）；
 * - 有 background 图层但都是近白纯色填充 → true；
 * - 有被设计过的背景（非近白填充色、或图片背景）→ false。
 * 没有足够信息判断（有 background 图层但无填充色也非图片）→ undefined。
 */
function computeBackgroundIsPlainDefault(snapshot: DesignSurfaceSnapshot): boolean | undefined {
    const backgrounds = snapshot.layers.filter((l) => isVisible(l) && l.kind === 'background');
    if (backgrounds.length === 0) return true;
    let sawDecidable = false;
    for (const bg of backgrounds) {
        if (bg.fillColor) {
            sawDecidable = true;
            if (!isNearWhite(bg.fillColor)) return false; //  有非白底设计
        }
    }
    if (!sawDecidable) return undefined; //  有背景层但无可判断的填充信息
    return true; //  全是近白填充
}

/**
 * 是否停在"产品图 + 居中文字 + 白底、卖点未视觉化"的排版及格线：
 * - 只有主体图 + 文本，没有任何 shape / 非主体 image（即没有色块、图标、对比图等视觉化手段）；
 * - 背景是默认白底；
 * - 所有文本都居中（无意排版）。判 true 要求**每个**文本层的 textAlign 已知且为 center：
 *   PS 描述符可能系统性省略默认左对齐（见 design-surface-snapshot-normalizer 的 UXP 字段说明），
 *   若把缺省层静默剔除只看剩下的层，"居中标题 + 左对齐正文"的有意排版会只剩居中层而误击发
 *   blocker（overall.above-baseline）。
 * 任一条件信息不足则 undefined——缺测量判 uneval、不基于部分信息下硬结论（与断言体系总语义一致）。
 */
function computeLayoutBaselineOnly(snapshot: DesignSurfaceSnapshot): boolean | undefined {
    const content = snapshot.layers.filter(isContentLayer);
    if (content.length === 0) return undefined;

    const hasShape = content.some((l) => l.kind === 'shape');
    const hasNonSubjectImage = content.some((l) => l.kind === 'image' && !l.isSubject);
    const texts = content.filter((l) => l.kind === 'text');
    if (texts.length === 0) return undefined; //  没文字谈不上"图+居中文字"（空集提前返回，杜绝 every([])=true 误判）
    const bgPlain = computeBackgroundIsPlainDefault(snapshot);
    if (bgPlain === undefined) return undefined;

    //  有任何视觉化手段（色块/图标/非主体配图）或非白底 → 已超出排版及格线（现有判断路径不受对齐缺省影响）
    if (hasShape || hasNonSubjectImage || bgPlain === false) return false;

    //  判 true（停在及格线）必须所有文本层对齐已知：任一缺失 → 该测量 undefined（上游判 uneval）
    if (texts.some((l) => l.textAlign === undefined)) return undefined;
    return texts.every((l) => l.textAlign === 'center');
}

/**
 * 从画面快照结构确定性算出设计测量值。算不出的字段留 undefined（上游据此判 uneval）。
 * subjectBackgroundContrast 需真实像素，本结构层无法得出，恒为 undefined（交视觉观察/像素探针补）。
 */
export function extractDesignQualityMeasurements(
    snapshot: DesignSurfaceSnapshot | null | undefined
): DesignQualityMeasurements {
    if (!snapshot || !snapshot.canvas || !Array.isArray(snapshot.layers)) {
        return {};
    }
    const measurements: DesignQualityMeasurements = {};

    const subjectAreaRatio = computeSubjectAreaRatio(snapshot);
    if (subjectAreaRatio !== undefined) measurements.subjectAreaRatio = subjectAreaRatio;

    const alignmentScore = computeAlignmentScore(snapshot);
    if (alignmentScore !== undefined) measurements.alignmentScore = alignmentScore;

    const titleToSubtitleScale = computeTitleToSubtitleScale(snapshot);
    if (titleToSubtitleScale !== undefined) measurements.titleToSubtitleScale = titleToSubtitleScale;

    const hasOverflow = computeHasOverflow(snapshot);
    if (hasOverflow !== undefined) measurements.hasOverflow = hasOverflow;

    const backgroundIsPlainDefault = computeBackgroundIsPlainDefault(snapshot);
    if (backgroundIsPlainDefault !== undefined) measurements.backgroundIsPlainDefault = backgroundIsPlainDefault;

    const layoutBaselineOnly = computeLayoutBaselineOnly(snapshot);
    if (layoutBaselineOnly !== undefined) measurements.layoutBaselineOnly = layoutBaselineOnly;

    measurements.elementCount = computeElementCount(snapshot);

    //  subjectBackgroundContrast 故意不填：结构层无像素，留给视觉观察/像素探针补，绝不伪造。
    return measurements;
}
