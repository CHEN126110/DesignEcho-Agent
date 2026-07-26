/**
 * 主体感知缩放（"合适的视觉大小"链路 · 纯逻辑）
 *
 * 问题：placeImage/renderLayout 按「图框」适配区域——图片留白多时主体看起来太小，
 * 留白少时又太满。"合适的大小"必须按「主体在画面里的真实呈现」计算。
 * 本模块把算术从模型手里拿走（布局引擎哲学的延续）：模型只声明
 * 「哪个图层的主体、填充哪个区域、到什么程度」，缩放比例与位移由这里确定性求解，
 * 执行复用现成 UXP 工具 alignToReference（缩放 + 主体中心对齐一步完成）。
 *
 * 坐标约定：全部为文档像素坐标；subjectBounds/layerBounds 为「缩放前」实测值
 * （getSubjectBounds / getLayerBounds 读回），与 alignToReference 的
 * subjectOffset（缩放前测量、内部按 k 缩放）语义一致。
 */

export interface SubjectFitRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface SubjectFitRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SubjectFitInput {
    /** 主体 bbox（文档坐标，缩放前，来自 getSubjectBounds） */
    subjectBounds: SubjectFitRect;
    /** 图层图框（文档坐标，缩放前，来自 getLayerBounds 的 boundsNoEffects||bounds） */
    layerBounds: SubjectFitRect;
    /** 期望主体呈现的目标区域（文档坐标） */
    targetRegion: SubjectFitRegion;
    /** 主体占目标区域的比例（contain 语义），默认 0.9；有效范围 (0,1] */
    subjectFillRatio?: number;
    /** 相对当前大小的放大上限（防画质崩），默认 3 */
    maxUpscaleRatio?: number;
    /** 画布尺寸（可选）：给出时对图框投影越出画布做提示 */
    canvas?: { width: number; height: number };
}

export interface SubjectFitPlan {
    ok: true;
    /** 直接喂给 alignToReference 的参数（layerId 由调用方补） */
    alignParams: {
        scalePercent: number;
        targetCenterX: number;
        targetCenterY: number;
        subjectOffsetX: number;
        subjectOffsetY: number;
    };
    /** 求解后主体的投影 bbox（供验证/告警） */
    projectedSubject: SubjectFitRect;
    /** 求解后图框的投影 bbox */
    projectedFrame: SubjectFitRect;
    warnings: string[];
}

export interface SubjectFitBlocked {
    ok: false;
    reason: string;
}

function rectWidth(rect: SubjectFitRect): number {
    return rect.right - rect.left;
}

function rectHeight(rect: SubjectFitRect): number {
    return rect.bottom - rect.top;
}

function isValidRect(rect: SubjectFitRect | undefined | null): rect is SubjectFitRect {
    return Boolean(rect)
        && [rect!.left, rect!.top, rect!.right, rect!.bottom].every((v) => Number.isFinite(Number(v)))
        && rectWidth(rect!) > 0 && rectHeight(rect!) > 0;
}

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * 求解「主体填充目标区域」的缩放与对齐计划。
 * contain 语义：缩放后主体完整落在 targetRegion 的 subjectFillRatio 比例内，主体中心=区域中心。
 */
export function computeSubjectFitToRegion(input: SubjectFitInput): SubjectFitPlan | SubjectFitBlocked {
    const warnings: string[] = [];
    if (!isValidRect(input.subjectBounds)) {
        return {
            ok: false,
            reason: '主体边界无效（宽高为 0 或缺字段）：先用 getSubjectBounds 读取主体（smart 不支持该图层类型时改 method="alpha"，或先转换为智能对象）。'
        };
    }
    if (!isValidRect(input.layerBounds)) {
        return { ok: false, reason: '图层边界无效：先用 getLayerBounds 读取该图层的真实图框。' };
    }
    const region = input.targetRegion;
    if (!region || !(Number(region.width) > 0) || !(Number(region.height) > 0)
        || !Number.isFinite(Number(region.x)) || !Number.isFinite(Number(region.y))) {
        return { ok: false, reason: 'targetRegion 无效：需要 {x,y,width,height} 且 width/height > 0（文档像素坐标）。' };
    }
    const subjectW = rectWidth(input.subjectBounds);
    const subjectH = rectHeight(input.subjectBounds);
    if (subjectW * subjectH < rectWidth(input.layerBounds) * rectHeight(input.layerBounds) * 0.002) {
        warnings.push('主体面积不足图框的 0.2%，主体检测结果可能不可靠——建议先用快照人工确认主体框再执行。');
    }

    const fillRatioRaw = Number(input.subjectFillRatio);
    const fillRatio = Number.isFinite(fillRatioRaw) && fillRatioRaw > 0 && fillRatioRaw <= 1 ? fillRatioRaw : 0.9;
    const maxUpscale = Number.isFinite(Number(input.maxUpscaleRatio)) && Number(input.maxUpscaleRatio) > 0
        ? Number(input.maxUpscaleRatio)
        : 3;

    let k = Math.min(
        (region.width * fillRatio) / subjectW,
        (region.height * fillRatio) / subjectH
    );
    if (k > maxUpscale) {
        warnings.push(`所需放大 ${round1(k * 100)}% 超出画质保护上限（${maxUpscale * 100}%），已按上限执行——主体会小于期望占比，可考虑换更高分辨率素材。`);
        k = maxUpscale;
    }
    if (k < 0.01) {
        return { ok: false, reason: `求解出的缩放比例异常（${round1(k * 100)}%）：目标区域相对主体过小，请检查 targetRegion 是否用了文档像素坐标。` };
    }

    const targetCenterX = region.x + region.width / 2;
    const targetCenterY = region.y + region.height / 2;
    const layerCenterX = input.layerBounds.left + rectWidth(input.layerBounds) / 2;
    const layerCenterY = input.layerBounds.top + rectHeight(input.layerBounds) / 2;
    const subjectCenterX = input.subjectBounds.left + subjectW / 2;
    const subjectCenterY = input.subjectBounds.top + subjectH / 2;
    // alignToReference 语义：subjectOffset 为缩放前「主体中心 - 图层中心」，其内部按 k 缩放
    const subjectOffsetX = subjectCenterX - layerCenterX;
    const subjectOffsetY = subjectCenterY - layerCenterY;

    const projectedSubject: SubjectFitRect = {
        left: targetCenterX - (subjectW * k) / 2,
        top: targetCenterY - (subjectH * k) / 2,
        right: targetCenterX + (subjectW * k) / 2,
        bottom: targetCenterY + (subjectH * k) / 2
    };
    // 图框中心最终位置 = 主体中心（=区域中心）反推：frameCenter = targetCenter - subjectOffset*k
    const frameW = rectWidth(input.layerBounds) * k;
    const frameH = rectHeight(input.layerBounds) * k;
    const frameCenterX = targetCenterX - subjectOffsetX * k;
    const frameCenterY = targetCenterY - subjectOffsetY * k;
    const projectedFrame: SubjectFitRect = {
        left: frameCenterX - frameW / 2,
        top: frameCenterY - frameH / 2,
        right: frameCenterX + frameW / 2,
        bottom: frameCenterY + frameH / 2
    };

    if (projectedFrame.left < region.x - 1 || projectedFrame.top < region.y - 1
        || projectedFrame.right > region.x + region.width + 1 || projectedFrame.bottom > region.y + region.height + 1) {
        warnings.push('图框（含留白）会溢出目标区域——主体感知缩放的正常现象；留意是否压到相邻模块（renderLayout 的遮挡自检会兜底）。');
    }
    if (input.canvas && (projectedFrame.left < -1 || projectedFrame.top < -1
        || projectedFrame.right > input.canvas.width + 1 || projectedFrame.bottom > input.canvas.height + 1)) {
        warnings.push('图框投影超出画布：超出部分不可见（相当于裁切构图），如非有意请缩小 subjectFillRatio。');
    }

    return {
        ok: true,
        alignParams: {
            scalePercent: round1(k * 100),
            targetCenterX: Math.round(targetCenterX),
            targetCenterY: Math.round(targetCenterY),
            subjectOffsetX: round1(subjectOffsetX),
            subjectOffsetY: round1(subjectOffsetY)
        },
        projectedSubject: {
            left: Math.round(projectedSubject.left),
            top: Math.round(projectedSubject.top),
            right: Math.round(projectedSubject.right),
            bottom: Math.round(projectedSubject.bottom)
        },
        projectedFrame: {
            left: Math.round(projectedFrame.left),
            top: Math.round(projectedFrame.top),
            right: Math.round(projectedFrame.right),
            bottom: Math.round(projectedFrame.bottom)
        },
        warnings
    };
}
