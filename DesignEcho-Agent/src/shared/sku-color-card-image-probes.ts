export type SkuColorCardImageProbeReviewStatus =
    | 'blocked_missing_export_readback'
    | 'blocked_export_readback'
    | 'needs_visual_metrics'
    | 'ready_for_review'
    | 'ready_for_review_with_warnings';

export interface SkuColorCardImageProbeSummary {
    expectedExportCount: number;
    fileProbeCount: number;
    metricProbeCount: number;
    centerXSpread: number;
    centerYSpread: number;
    widthRatioSpread: number;
    heightRatioSpread: number;
    averageLumaSpread: number;
    shadowLikeRatioSpread: number;
    minTextureContrastScore?: number;
    maxEdgeOccupancy: number;
}

export interface SkuColorCardImageProbeReview {
    version: 'sku-color-card-image-probes/v0';
    status: SkuColorCardImageProbeReviewStatus;
    generatedAt: string;
    summary: SkuColorCardImageProbeSummary;
    probeRequirements: string[];
    reviewSignals: string[];
    blockers: string[];
    warnings: string[];
    qualityClaim: {
        allowed: false;
        reason: string;
    };
    boundaries: {
        readonly: true;
        rawImagesRedacted: true;
        localPathsRedacted: true;
        doesNotRunProvider: true;
        doesNotRunPhotoshop: true;
        doesNotClaimDesignQuality: true;
    };
    canPrepareHumanReview: boolean;
    canClaimDesignQuality: false;
    canRunProvider: false;
    canRunPhotoshop: false;
}

export interface BuildSkuColorCardImageProbeReviewInput {
    exportReadback?: unknown;
    colorCardRetouchStrategy?: unknown;
    generatedAt?: unknown;
}

type MetricRecord = {
    centerX?: number;
    centerY?: number;
    widthRatio?: number;
    heightRatio?: number;
    averageLuma?: number;
    shadowLikePixelRatio?: number;
    textureContrastScore?: number;
    maxEdgeOccupancy?: number;
};

const DEFAULT_PROBE_REQUIREMENTS = [
    '轮廓探针：检查每个 SKU 导出图的主体边界、中心和宽高占比是否接近。',
    '袜口探针：用主体上边界和中心偏移辅助判断袜口高度、顶部对齐和特殊罗口保真。',
    '阴影探针：检查灰度阴影像素比例、接触阴影强弱和白底边缘是否需要人工复核。',
    '纹理探针：检查纹理对比度是否过低，避免精修后针织纹理被抹平。',
    '边缘探针：检查主体是否贴近画布边缘，避免导出裁切、残影和背景污染。'
];

export function buildSkuColorCardImageProbeReview(
    input: BuildSkuColorCardImageProbeReviewInput
): SkuColorCardImageProbeReview {
    const generatedAt = normalizeIsoTime(input.generatedAt);
    const exportReadback = readRecord(input.exportReadback);
    const expectedExportCount = toCount(exportReadback?.expectedExportCount);
    const fileProbes = Array.isArray(exportReadback?.fileProbes) ? exportReadback.fileProbes : [];
    const metricRecords = fileProbes
        .map(readProbeMetricRecord)
        .filter(Boolean) as MetricRecord[];
    const summary = buildSummary({
        expectedExportCount,
        fileProbeCount: fileProbes.length,
        metrics: metricRecords
    });
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!exportReadback) {
        blockers.push('缺少 skuExportReadback，无法对 SKU 色卡导出图做只读图像探针。');
    } else if (sanitizeText(exportReadback.status) !== 'ready_for_review') {
        blockers.push(`SKU 导出读回未通过，不能进行色卡图像探针复核：${sanitizeText(exportReadback.status) || 'unknown'}`);
    }
    if (exportReadback && metricRecords.length === 0) {
        blockers.push('导出文件探针没有 visualMetrics，无法评估轮廓、阴影、边缘和纹理一致性。');
    } else if (exportReadback && metricRecords.length < expectedExportCount) {
        warnings.push(`只有 ${metricRecords.length}/${expectedExportCount} 个导出图包含 visualMetrics，色卡一致性仍需人工补检。`);
    }
    if (summary.centerXSpread > 0.08 || summary.centerYSpread > 0.08) {
        warnings.push('主体中心位置离散较大，需要人工检查袜子排列是否工整。');
    }
    if (summary.widthRatioSpread > 0.08 || summary.heightRatioSpread > 0.08) {
        warnings.push('主体占比离散较大，需要人工检查袜子缩放和形态是否统一。');
    }
    if (summary.averageLumaSpread > 45) {
        warnings.push('平均亮度离散较大，需要人工检查白场、明暗和不同颜色的光影统一。');
    }
    if (summary.shadowLikeRatioSpread > 0.12) {
        warnings.push('阴影像素比例离散较大，需要人工检查正片叠底阴影层和接触阴影自然度。');
    }
    if (typeof summary.minTextureContrastScore === 'number' && summary.minTextureContrastScore < 2) {
        warnings.push('至少一个导出图纹理对比度偏低，需要人工确认针织纹理是否被抹平。');
    }
    if (summary.maxEdgeOccupancy > 0.22) {
        warnings.push('导出图边缘占用偏高，需要人工检查裁切、灰边或背景污染。');
    }

    const status = blockers.length > 0
        ? (exportReadback ? 'needs_visual_metrics' : 'blocked_missing_export_readback')
        : warnings.length > 0
            ? 'ready_for_review_with_warnings'
            : 'ready_for_review';

    const strategyRequirements = normalizeStrategyRequirements(input.colorCardRetouchStrategy);

    return {
        version: 'sku-color-card-image-probes/v0',
        status: status === 'needs_visual_metrics' && exportReadback && sanitizeText(exportReadback.status) !== 'ready_for_review'
            ? 'blocked_export_readback'
            : status,
        generatedAt,
        summary,
        probeRequirements: uniqueStrings([
            ...DEFAULT_PROBE_REQUIREMENTS,
            ...strategyRequirements
        ]),
        reviewSignals: buildReviewSignals(summary),
        blockers: uniqueStrings(blockers).slice(0, 12),
        warnings: uniqueStrings(warnings).slice(0, 12),
        qualityClaim: {
            allowed: false,
            reason: '只读图像探针只能提示可能的轮廓、光影、阴影、纹理和边缘问题，不能替代真实视觉 QA、截图或人工复核。'
        },
        boundaries: {
            readonly: true,
            rawImagesRedacted: true,
            localPathsRedacted: true,
            doesNotRunProvider: true,
            doesNotRunPhotoshop: true,
            doesNotClaimDesignQuality: true
        },
        canPrepareHumanReview: blockers.length === 0,
        canClaimDesignQuality: false,
        canRunProvider: false,
        canRunPhotoshop: false
    };
}

function buildSummary(input: {
    expectedExportCount: number;
    fileProbeCount: number;
    metrics: MetricRecord[];
}): SkuColorCardImageProbeSummary {
    return {
        expectedExportCount: input.expectedExportCount,
        fileProbeCount: input.fileProbeCount,
        metricProbeCount: input.metrics.length,
        centerXSpread: spread(input.metrics.map((item) => item.centerX)),
        centerYSpread: spread(input.metrics.map((item) => item.centerY)),
        widthRatioSpread: spread(input.metrics.map((item) => item.widthRatio)),
        heightRatioSpread: spread(input.metrics.map((item) => item.heightRatio)),
        averageLumaSpread: spread(input.metrics.map((item) => item.averageLuma)),
        shadowLikeRatioSpread: spread(input.metrics.map((item) => item.shadowLikePixelRatio)),
        minTextureContrastScore: minValue(input.metrics.map((item) => item.textureContrastScore)),
        maxEdgeOccupancy: maxValue(input.metrics.map((item) => item.maxEdgeOccupancy)) || 0
    };
}

function buildReviewSignals(summary: SkuColorCardImageProbeSummary): string[] {
    return uniqueStrings([
        `主体中心 X 离散：${summary.centerXSpread}`,
        `主体中心 Y 离散：${summary.centerYSpread}`,
        `主体宽度占比离散：${summary.widthRatioSpread}`,
        `主体高度占比离散：${summary.heightRatioSpread}`,
        `平均亮度离散：${summary.averageLumaSpread}`,
        `阴影像素比例离散：${summary.shadowLikeRatioSpread}`,
        typeof summary.minTextureContrastScore === 'number'
            ? `最低纹理对比度：${summary.minTextureContrastScore}`
            : '',
        `最大边缘占用：${summary.maxEdgeOccupancy}`
    ]);
}

function readProbeMetricRecord(value: unknown): MetricRecord | undefined {
    const probe = readRecord(value);
    const metrics = readRecord(probe?.visualMetrics);
    if (!metrics || metrics.rawImagesRedacted !== true) return undefined;
    const bounds = readRecord(metrics.nonWhiteBounds);
    const edge = readRecord(metrics.edgeOccupancy);
    return {
        centerX: normalizeRatio(bounds?.centerX),
        centerY: normalizeRatio(bounds?.centerY),
        widthRatio: normalizeRatio(bounds?.widthRatio),
        heightRatio: normalizeRatio(bounds?.heightRatio),
        averageLuma: normalizeMetric(metrics.averageLuma),
        shadowLikePixelRatio: normalizeRatio(metrics.shadowLikePixelRatio),
        textureContrastScore: normalizeMetric(metrics.textureContrastScore),
        maxEdgeOccupancy: maxValue([
            normalizeRatio(edge?.top),
            normalizeRatio(edge?.right),
            normalizeRatio(edge?.bottom),
            normalizeRatio(edge?.left)
        ])
    };
}

function normalizeStrategyRequirements(value: unknown): string[] {
    const strategy = readRecord(value);
    if (!strategy || sanitizeText(strategy.version) !== 'sku-color-card-retouch-strategy/v0') return [];
    return normalizeTextList(strategy.reviewRequirements).map((item) => {
        if (item.includes('shape')) return '结合策略复核袜子形态、姿态、比例和基线一致性。';
        if (item.includes('cuff')) return '结合策略复核袜口、罗口、花边和特殊造型保真。';
        if (item.includes('lighting') || item.includes('white') || item.includes('knit')) return '结合策略复核白点、光影统一和针织纹理保留。';
        if (item.includes('shadow')) return '结合策略复核阴影层、正片叠底和接触阴影自然度。';
        return '';
    });
}

function normalizeIsoTime(value: unknown): string {
    const text = sanitizeText(value);
    const date = text ? new Date(text) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeTextList(value: unknown): string[] {
    const rawValues = Array.isArray(value) ? value : [value];
    return rawValues.map(sanitizeText).filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(sanitizeText).filter(Boolean)));
}

function spread(values: Array<number | undefined>): number {
    const nums = values.filter((value): value is number => Number.isFinite(value));
    if (nums.length < 2) return 0;
    return round(Math.max(...nums) - Math.min(...nums));
}

function minValue(values: Array<number | undefined>): number | undefined {
    const nums = values.filter((value): value is number => Number.isFinite(value));
    if (nums.length === 0) return undefined;
    return round(Math.min(...nums));
}

function maxValue(values: Array<number | undefined>): number | undefined {
    const nums = values.filter((value): value is number => Number.isFinite(value));
    if (nums.length === 0) return undefined;
    return round(Math.max(...nums));
}

function normalizeRatio(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return undefined;
    return Math.max(0, Math.min(1, round(numberValue)));
}

function normalizeMetric(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return undefined;
    return round(numberValue);
}

function toCount(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
}

function round(value: number): number {
    return Math.round(value * 10000) / 10000;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function sanitizeText(value: unknown): string {
    return String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[^\s"'<>]+/gi, '[已移除图片内容]')
        .replace(/\bbase64\b/gi, '[已移除编码内容]')
        .replace(/\brawImage\b/gi, '[已移除图片字段]')
        .replace(/\braw-image-payload\b/gi, '[已移除图片字段]')
        .replace(/\bbase64-image-payload\b/gi, '[已移除编码内容]')
        .replace(/[A-Za-z]:\\[^\s，。；;'"<>]+/g, '[已移除本地路径]')
        .replace(/\s+/g, ' ')
        .trim();
}
