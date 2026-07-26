/**
 * 设计尺寸规范（用户可配置，默认走预设）
 *
 * 原则：尺寸不在业务代码里写死。预设承载电商常用规范（详情页 790 宽、主图 800 等），
 * 用户可在设置中覆盖任意字段；消费方（详情页校验、导出默认值、Agent 上下文注入）
 * 一律经 normalizeDesignDimensionSpec 合并后读取。
 * 用户工作流注意：同名文档存在多尺寸版本（基准版 + 等比放大的工作版），
 * 宽度校验必须同时接受基准宽与「基准宽 × 放大倍率」。
 */

export interface DesignDimensionSpec {
    version: 'design-dimension-spec/v1';
    /** 详情页规范 */
    detailPage: {
        /** 基准宽度（px），导出交付宽度 */
        baseWidth: number;
        /** 可接受的宽度变体（多平台：750/790/800/1200 等） */
        acceptableWidths: number[];
        /** 单屏建议高度范围（px，基准宽度下） */
        screenHeightRange: { min: number; max: number };
    };
    /** 主图规范 */
    mainImage: {
        width: number;
        height: number;
    };
    /** 放大工作版倍率（同名文档、等比放大、比例不变） */
    workingScaleFactors: number[];
    /** 导出默认值 */
    exportDefaults: {
        format: 'jpeg' | 'png';
        /** JPEG 质量 1-12（Photoshop 标度） */
        quality: number;
    };
}

export const DEFAULT_DESIGN_DIMENSION_SPEC: DesignDimensionSpec = {
    version: 'design-dimension-spec/v1',
    detailPage: {
        baseWidth: 790,
        acceptableWidths: [750, 790, 800, 1200],
        screenHeightRange: { min: 600, max: 2600 }
    },
    mainImage: {
        width: 800,
        height: 800
    },
    workingScaleFactors: [1, 2],
    exportDefaults: {
        format: 'jpeg',
        quality: 10
    }
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizePositiveList(value: unknown, fallback: number[]): number[] {
    if (!Array.isArray(value)) return [...fallback];
    const list = value
        .map((item) => Number(item))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.round(n * 100) / 100);
    return list.length > 0 ? [...new Set(list)] : [...fallback];
}

export function normalizeDesignDimensionSpec(
    partial?: Partial<DesignDimensionSpec> | null
): DesignDimensionSpec {
    const d = DEFAULT_DESIGN_DIMENSION_SPEC;
    const detail = partial?.detailPage || ({} as Partial<DesignDimensionSpec['detailPage']>);
    const main = partial?.mainImage || ({} as Partial<DesignDimensionSpec['mainImage']>);
    const exp = partial?.exportDefaults || ({} as Partial<DesignDimensionSpec['exportDefaults']>);
    const heightRange = (detail as any).screenHeightRange || {};
    const min = clampNumber(heightRange.min, 100, 20000, d.detailPage.screenHeightRange.min);
    const max = clampNumber(heightRange.max, min, 40000, Math.max(min, d.detailPage.screenHeightRange.max));
    return {
        version: 'design-dimension-spec/v1',
        detailPage: {
            baseWidth: clampNumber((detail as any).baseWidth, 100, 8000, d.detailPage.baseWidth),
            acceptableWidths: normalizePositiveList((detail as any).acceptableWidths, d.detailPage.acceptableWidths),
            screenHeightRange: { min, max }
        },
        mainImage: {
            width: clampNumber((main as any).width, 100, 8000, d.mainImage.width),
            height: clampNumber((main as any).height, 100, 8000, d.mainImage.height)
        },
        workingScaleFactors: normalizePositiveList(partial?.workingScaleFactors, d.workingScaleFactors),
        exportDefaults: {
            format: (exp as any).format === 'png' ? 'png' : 'jpeg',
            quality: clampNumber((exp as any).quality, 1, 12, d.exportDefaults.quality)
        }
    };
}

/** 详情页文档宽度是否符合规范（含变体宽与放大版倍率） */
export function evaluateDetailPageDocumentWidth(
    spec: DesignDimensionSpec,
    documentWidth: number
): { ok: boolean; matchedWidth?: number; scaleFactor?: number; hint: string } {
    const width = Math.round(Number(documentWidth) || 0);
    if (width <= 0) {
        return { ok: false, hint: '文档宽度无效（0），无法按规范校验。' };
    }
    const tolerance = 4;
    const candidates = [...new Set([spec.detailPage.baseWidth, ...spec.detailPage.acceptableWidths])];
    for (const base of candidates) {
        for (const factor of spec.workingScaleFactors) {
            if (Math.abs(width - base * factor) <= tolerance) {
                return {
                    ok: true,
                    matchedWidth: base,
                    scaleFactor: factor,
                    hint: factor === 1
                        ? `宽度 ${width} 命中规范基准宽 ${base}。`
                        : `宽度 ${width} 命中规范宽 ${base} 的 ${factor}× 工作版（导出按基准宽交付）。`
                };
            }
        }
    }
    return {
        ok: false,
        hint: `宽度 ${width} 不在规范内（基准 ${spec.detailPage.baseWidth}，可接受 ${candidates.join('/')}，放大倍率 ${spec.workingScaleFactors.join('/')}）。请确认文档版本或在设置中调整尺寸规范。`
    };
}

/** 给 Agent 上下文注入的中文摘要 */
export function summarizeDesignDimensionSpecForAgent(spec: DesignDimensionSpec): string {
    return [
        '【设计尺寸规范（用户可在设置中调整，未调整时为预设）】',
        '优先级：以下只是「用户本次没有明确给出尺寸时」的默认预设。一旦用户在本次需求里明确指定了尺寸'
        + '（如「1440x1440」「宽1200」「做成 800 的」等），一律以用户明确的尺寸为准，直接按用户尺寸创建文档，'
        + '不得用下列预设覆盖、纠正或替换用户的尺寸。',
        `详情页基准宽 ${spec.detailPage.baseWidth}px（可接受变体 ${spec.detailPage.acceptableWidths.join('/')}px），单屏高度建议 ${spec.detailPage.screenHeightRange.min}-${spec.detailPage.screenHeightRange.max}px。`,
        `主图 ${spec.mainImage.width}×${spec.mainImage.height}px。`,
        `同名文档可能存在等比放大工作版（倍率 ${spec.workingScaleFactors.join('/')}×），比例不变；导出按基准宽交付。`,
        `导出默认 ${spec.exportDefaults.format.toUpperCase()}，质量 ${spec.exportDefaults.quality}。`
    ].join('\n');
}
