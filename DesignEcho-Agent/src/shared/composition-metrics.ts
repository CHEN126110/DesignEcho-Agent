/**
 * 参考构图测量（"该多大"的依据源 · 纯逻辑）
 *
 * 问题：fitLayerSubjectToRegion / placeImage targetBounds 的"手"已齐，但 subjectFillRatio
 * 与目标区域该给多少，模型无据可依（拍脑袋给数字）。审美大小不是随便的——要么有档位
 * 依据（design-principles 构图节），要么照参考参照（本模块）。
 *
 * 本模块把「参考图的构图」变成可测量的数值：主体在参考画布里占多大、重心在哪、
 * 四边留白多少——再换算成 fitLayerSubjectToRegion 可直接使用的 subjectFillRatio 建议。
 * 模型仍不自己算百分比：测量与换算在这里确定性完成，模型只是把有依据的数值
 * 传给执行引擎（布局引擎哲学的延续）。
 *
 * 坐标约定：subjectBounds 为参考图像素坐标（来自主体检测），canvas 为参考图尺寸。
 * 输出全部为归一化比例（0~1），与参考图分辨率无关，可跨尺寸应用。
 */

export interface CompositionMetricsInput {
    /** 参考图画布尺寸（像素） */
    canvas: { width: number; height: number };
    /** 主体 bbox（参考图像素坐标） */
    subjectBounds: { left: number; top: number; right: number; bottom: number };
}

export interface CompositionMetrics {
    /** 主体面积占画布比例（0~1） */
    subjectAreaRatio: number;
    /** 主体高度占画布高度比例（0~1） */
    subjectHeightRatio: number;
    /** 主体宽度占画布宽度比例（0~1） */
    subjectWidthRatio: number;
    /** 主体中心在画布中的归一化位置（0~1，x 向右 y 向下） */
    subjectCenter: { x: number; y: number };
    /** 四边留白占对应画布边长的比例（0~1） */
    margins: { top: number; bottom: number; left: number; right: number };
    /** 主体宽高比（宽/高） */
    subjectAspectRatio: number;
}

export interface CompositionApplication {
    /**
     * 若目标区域 = 整个画布（最常见：主图主体直接对全幅），fitLayerSubjectToRegion 的
     * subjectFillRatio 建议值 = max(高占比, 宽占比)——contain 语义按先触边的一侧对齐，
     * 取较大占比可让主体呈现与参考一致的视觉尺寸。
     */
    subjectFillRatioForFullCanvas: number;
    /**
     * 复刻参考重心的目标区域（归一化，0~1）：以参考主体为中心、按参考占比扩成的区域。
     * 应用时乘以目标画布宽高即得 targetRegion 像素值。
     */
    normalizedTargetRegion: { x: number; y: number; width: number; height: number };
    /** 换算说明（给模型看的使用方法，一段话） */
    usage: string;
}

export interface CompositionMeasurement {
    ok: true;
    metrics: CompositionMetrics;
    application: CompositionApplication;
    warnings: string[];
}

export interface CompositionMeasurementError {
    ok: false;
    error: string;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

/**
 * 由参考画布与主体 bbox 计算构图测量与应用建议。
 * 输入不合法（画布非正、bbox 退化或完全在画布外）时返回可诊断错误。
 */
export function measureComposition(input: CompositionMetricsInput): CompositionMeasurement | CompositionMeasurementError {
    const cw = Number(input?.canvas?.width);
    const ch = Number(input?.canvas?.height);
    if (!Number.isFinite(cw) || !Number.isFinite(ch) || cw <= 0 || ch <= 0) {
        return { ok: false, error: `构图测量失败：参考图画布尺寸不合法（width=${input?.canvas?.width}, height=${input?.canvas?.height}）。` };
    }
    const b = input?.subjectBounds;
    const left = Number(b?.left);
    const top = Number(b?.top);
    const right = Number(b?.right);
    const bottom = Number(b?.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)) {
        return { ok: false, error: '构图测量失败：主体 bbox 含非数值字段（需要 left/top/right/bottom）。' };
    }
    if (right <= left || bottom <= top) {
        return { ok: false, error: `构图测量失败：主体 bbox 退化（left=${left}, top=${top}, right=${right}, bottom=${bottom}），主体检测可能没有命中有效主体。` };
    }
    if (right <= 0 || bottom <= 0 || left >= cw || top >= ch) {
        return { ok: false, error: '构图测量失败：主体 bbox 完全在画布之外，参考图与检测结果不匹配。' };
    }

    const warnings: string[] = [];
    // 裁到画布内再测（越界部分不参与视觉呈现）
    const cl = Math.max(0, left);
    const ct = Math.max(0, top);
    const cr = Math.min(cw, right);
    const cb = Math.min(ch, bottom);
    if (cl !== left || ct !== top || cr !== right || cb !== bottom) {
        warnings.push('主体 bbox 部分越出画布，已按画布内可见部分测量（参考图可能是出血/裁切构图）。');
    }

    const sw = cr - cl;
    const sh = cb - ct;
    const heightRatio = clamp01(sh / ch);
    const widthRatio = clamp01(sw / cw);
    const areaRatio = clamp01((sw * sh) / (cw * ch));
    const centerX = clamp01((cl + cr) / 2 / cw);
    const centerY = clamp01((ct + cb) / 2 / ch);

    const metrics: CompositionMetrics = {
        subjectAreaRatio: round3(areaRatio),
        subjectHeightRatio: round3(heightRatio),
        subjectWidthRatio: round3(widthRatio),
        subjectCenter: { x: round3(centerX), y: round3(centerY) },
        margins: {
            top: round3(clamp01(ct / ch)),
            bottom: round3(clamp01((ch - cb) / ch)),
            left: round3(clamp01(cl / cw)),
            right: round3(clamp01((cw - cr) / cw))
        },
        subjectAspectRatio: round3(sw / sh)
    };

    if (areaRatio < 0.02) {
        warnings.push('主体占比不足 2%：参考里主体极小，可能是氛围图而非主体展示图，参照其占比前先确认参考类型。');
    }
    if (areaRatio > 0.95) {
        warnings.push('主体占比超 95%：参考近乎满幅（特写/裁切构图），照搬到全幅区域会没有留白。');
    }

    const fillRatio = round3(clamp01(Math.max(heightRatio, widthRatio)));
    const application: CompositionApplication = {
        subjectFillRatioForFullCanvas: fillRatio,
        normalizedTargetRegion: {
            x: round3(clamp01(centerX - widthRatio / 2)),
            y: round3(clamp01(centerY - heightRatio / 2)),
            width: round3(widthRatio),
            height: round3(heightRatio)
        },
        usage: `参考里主体高占 ${(heightRatio * 100).toFixed(0)}%、宽占 ${(widthRatio * 100).toFixed(0)}%、重心在 (${(centerX * 100).toFixed(0)}%, ${(centerY * 100).toFixed(0)}%)。要在目标画布复现同等视觉大小：目标区域=整幅时 fitLayerSubjectToRegion 直接用 subjectFillRatio=${fillRatio}；要同时复现参考重心，用 normalizedTargetRegion 乘以目标画布宽高得 targetRegion，再配 subjectFillRatio≈0.95（区域已按参考占比收窄，主体填满该区域即可）。数值是参照起点，最终以画面观察为准。`
    };

    return { ok: true, metrics, application, warnings };
}
