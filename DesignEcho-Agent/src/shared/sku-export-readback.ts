export type SkuExportReadbackStatus = 'no_exports' | 'needs_file_probe' | 'ready_for_review' | 'blocked';

export type SkuExportFileProbeInput = {
    success?: boolean;
    path?: string;
    status?: 'ok' | 'missing' | 'not_file' | 'unsupported' | 'decode_failed' | string;
    exists?: boolean;
    isFile?: boolean;
    byteLength?: number;
    format?: string;
    mimeType?: string;
    dimensions?: { width?: number; height?: number };
    visualMetrics?: SkuExportVisualMetricsInput;
    sha256?: string;
    rawImagesRedacted?: boolean;
    error?: string;
};

export type SkuExportVisualMetricsInput = {
    sampleSize?: { width?: number; height?: number };
    nonWhitePixelRatio?: number;
    nonWhiteBounds?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        centerX?: number;
        centerY?: number;
        widthRatio?: number;
        heightRatio?: number;
    };
    edgeOccupancy?: { top?: number; right?: number; bottom?: number; left?: number };
    averageLuma?: number;
    lumaStdDev?: number;
    darkPixelRatio?: number;
    highlightPixelRatio?: number;
    shadowLikePixelRatio?: number;
    textureContrastScore?: number;
    backgroundColor?: {
        r?: number;
        g?: number;
        b?: number;
        luma?: number;
    };
    backgroundDistanceThreshold?: number;
    rawImagesRedacted?: boolean;
};

export type SkuExportVisualMetrics = {
    sampleSize: { width: number; height: number };
    nonWhitePixelRatio: number;
    nonWhiteBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
        centerX: number;
        centerY: number;
        widthRatio: number;
        heightRatio: number;
    };
    edgeOccupancy: { top: number; right: number; bottom: number; left: number };
    averageLuma?: number;
    lumaStdDev?: number;
    darkPixelRatio: number;
    highlightPixelRatio: number;
    shadowLikePixelRatio: number;
    textureContrastScore?: number;
    backgroundColor?: {
        r: number;
        g: number;
        b: number;
        luma: number;
    };
    backgroundDistanceThreshold?: number;
    rawImagesRedacted: true;
};

export type SkuExportReadbackProbe = {
    fileName: string;
    status: string;
    success: boolean;
    byteLength?: number;
    format?: string;
    mimeType?: string;
    dimensions?: { width: number; height: number };
    expectedDimensions?: { width: number; height: number };
    visualMetrics?: SkuExportVisualMetrics;
    sha256?: string;
    rawImagesRedacted: boolean;
    error?: string;
};

export type SkuExpectedExportReadbackInput = {
    path?: string;
    expectedDimensions?: { width?: number; height?: number } | null;
};

export type SkuExportReadback = {
    version: 'sku-export-readback/v0';
    status: SkuExportReadbackStatus;
    expectedExportCount: number;
    fileProbeCount: number;
    okFileProbeCount: number;
    failedFileProbeCount: number;
    missingFileProbeCount: number;
    dimensionMismatchCount: number;
    visualMetricBlockerCount: number;
    resultFileNames: string[];
    fileProbes: SkuExportReadbackProbe[];
    blockers: string[];
    warnings: string[];
    boundaries: {
        readonly: true;
        rawImagesRedacted: true;
        doesNotClaimDesignQuality: true;
        doesNotRunPhotoshop: true;
    };
};

export type BuildSkuExportReadbackInput = {
    expectedExportPaths?: string[] | null;
    expectedExports?: SkuExpectedExportReadbackInput[] | null;
    fileProbes?: SkuExportFileProbeInput[] | null;
    expectedDimensions?: { width?: number; height?: number } | null;
};

export type SkuPublicToolResult = {
    toolName?: string;
    result?: unknown;
};

function basename(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

function normalizeDimension(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) return undefined;
    return Math.round(numberValue);
}

function normalizeExpectedDimensions(
    value?: { width?: number; height?: number } | null
): { width: number; height: number } | undefined {
    const width = normalizeDimension(value?.width);
    const height = normalizeDimension(value?.height);
    if (width === undefined || height === undefined) return undefined;
    return { width, height };
}

function sanitizeProbe(
    probe: SkuExportFileProbeInput,
    expectedDimensions?: { width: number; height: number }
): SkuExportReadbackProbe {
    const width = normalizeDimension(probe?.dimensions?.width);
    const height = normalizeDimension(probe?.dimensions?.height);
    const success = probe?.success === true && probe?.status === 'ok' && probe?.rawImagesRedacted === true;
    return {
        fileName: basename(probe?.path) || 'unknown',
        status: String(probe?.status || (success ? 'ok' : 'unknown')),
        success,
        byteLength: normalizeDimension(probe?.byteLength),
        format: probe?.format ? String(probe.format) : undefined,
        mimeType: probe?.mimeType ? String(probe.mimeType) : undefined,
        dimensions: width !== undefined && height !== undefined ? { width, height } : undefined,
        expectedDimensions,
        visualMetrics: sanitizeVisualMetrics(probe?.visualMetrics),
        sha256: probe?.sha256 ? String(probe.sha256).slice(0, 16) : undefined,
        rawImagesRedacted: probe?.rawImagesRedacted === true,
        error: probe?.error ? String(probe.error) : undefined
    };
}

function normalizeRatio(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return undefined;
    return Math.max(0, Math.min(1, Math.round(numberValue * 10000) / 10000));
}

function normalizeMetric(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return undefined;
    return Math.round(numberValue * 100) / 100;
}

function sanitizeVisualMetrics(value: unknown): SkuExportVisualMetrics | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const metrics = value as SkuExportVisualMetricsInput;
    if (metrics.rawImagesRedacted !== true) return undefined;
    const sampleWidth = normalizeDimension(metrics.sampleSize?.width);
    const sampleHeight = normalizeDimension(metrics.sampleSize?.height);
    const nonWhitePixelRatio = normalizeRatio(metrics.nonWhitePixelRatio);
    if (sampleWidth === undefined || sampleHeight === undefined || nonWhitePixelRatio === undefined) {
        return undefined;
    }
    const bounds = metrics.nonWhiteBounds;
    const background = metrics.backgroundColor;
    const normalizedBounds = bounds
        && normalizeRatio(bounds.x) !== undefined
        && normalizeRatio(bounds.y) !== undefined
        && normalizeDimension(bounds.width) !== undefined
        && normalizeDimension(bounds.height) !== undefined
        && normalizeRatio(bounds.centerX) !== undefined
        && normalizeRatio(bounds.centerY) !== undefined
        && normalizeRatio(bounds.widthRatio) !== undefined
        && normalizeRatio(bounds.heightRatio) !== undefined
        ? {
            x: normalizeRatio(bounds.x) as number,
            y: normalizeRatio(bounds.y) as number,
            width: normalizeDimension(bounds.width) as number,
            height: normalizeDimension(bounds.height) as number,
            centerX: normalizeRatio(bounds.centerX) as number,
            centerY: normalizeRatio(bounds.centerY) as number,
            widthRatio: normalizeRatio(bounds.widthRatio) as number,
            heightRatio: normalizeRatio(bounds.heightRatio) as number
        }
        : undefined;
    return {
        sampleSize: { width: sampleWidth, height: sampleHeight },
        nonWhitePixelRatio,
        nonWhiteBounds: normalizedBounds,
        edgeOccupancy: {
            top: normalizeRatio(metrics.edgeOccupancy?.top) || 0,
            right: normalizeRatio(metrics.edgeOccupancy?.right) || 0,
            bottom: normalizeRatio(metrics.edgeOccupancy?.bottom) || 0,
            left: normalizeRatio(metrics.edgeOccupancy?.left) || 0
        },
        averageLuma: normalizeMetric(metrics.averageLuma),
        lumaStdDev: normalizeMetric(metrics.lumaStdDev),
        darkPixelRatio: normalizeRatio(metrics.darkPixelRatio) || 0,
        highlightPixelRatio: normalizeRatio(metrics.highlightPixelRatio) || 0,
        shadowLikePixelRatio: normalizeRatio(metrics.shadowLikePixelRatio) || 0,
        textureContrastScore: normalizeMetric(metrics.textureContrastScore),
        backgroundColor: background
            && normalizeDimension(background.r) !== undefined
            && normalizeDimension(background.g) !== undefined
            && normalizeDimension(background.b) !== undefined
            && normalizeMetric(background.luma) !== undefined
            ? {
                r: normalizeDimension(background.r) as number,
                g: normalizeDimension(background.g) as number,
                b: normalizeDimension(background.b) as number,
                luma: normalizeMetric(background.luma) as number
            }
            : undefined,
        backgroundDistanceThreshold: normalizeMetric(metrics.backgroundDistanceThreshold),
        rawImagesRedacted: true
    };
}

function hasDimensionMismatch(probe: SkuExportReadbackProbe): boolean {
    if (!probe.success || !probe.dimensions || !probe.expectedDimensions) return false;
    if (probe.dimensions.width !== probe.expectedDimensions.width) return true;
    if (probe.dimensions.height !== probe.expectedDimensions.height) return true;
    return false;
}

function getMaxEdgeOccupancy(metrics?: SkuExportVisualMetrics): number {
    if (!metrics) return 0;
    return Math.max(
        metrics.edgeOccupancy.top || 0,
        metrics.edgeOccupancy.right || 0,
        metrics.edgeOccupancy.bottom || 0,
        metrics.edgeOccupancy.left || 0
    );
}

function getFinalImageMetricBlocker(probe: SkuExportReadbackProbe): string | undefined {
    if (!probe.success) return undefined;
    const metrics = probe.visualMetrics;
    if (!metrics) return undefined;
    const bounds = metrics.nonWhiteBounds;
    if (metrics.nonWhitePixelRatio <= 0.005 || !bounds) {
        return `导出图几乎为空或缺少主体边界：${probe.fileName}`;
    }
    if (bounds.widthRatio < 0.04 || bounds.heightRatio < 0.04) {
        return `导出图主体像素占比异常偏小：${probe.fileName}`;
    }
    if (getMaxEdgeOccupancy(metrics) > 0.55) {
        return `导出图主体边缘占用过高，可能存在裁切或贴边：${probe.fileName}`;
    }
    if (bounds.centerX < 0.06 || bounds.centerX > 0.94 || bounds.centerY < 0.06 || bounds.centerY > 0.94) {
        return `导出图主体中心明显偏离画布：${probe.fileName}`;
    }
    return undefined;
}

function normalizePathKey(value: unknown): string {
    return String(value || '').trim().replace(/\//g, '\\').toLowerCase();
}

function looksLikeAbsoluteLocalPath(value: string): boolean {
    const text = String(value || '').trim();
    return /^[a-zA-Z]:[\\/]/.test(text)
        || text.startsWith('\\\\')
        || /^\/(users|home|var|tmp|mnt)\//i.test(text);
}

function isSensitivePathKey(key?: string): boolean {
    return /(^|_)(path|dir|directory|tempPath|targetDir|sourcePath|filePath|outputDir)$/i.test(String(key || ''));
}

function sanitizePublicString(value: string, key?: string): string {
    const text = String(value || '');
    if (/data:image\/|base64-image-payload|raw-image-payload/i.test(text)) {
        return '[raw-image-redacted]';
    }
    const maybeJson = text.trim();
    if (maybeJson.startsWith('{') && maybeJson.endsWith('}')) {
        try {
            return JSON.stringify(sanitizeSkuPublicValue(JSON.parse(maybeJson), key));
        } catch {
            // Fall through to local path redaction.
        }
    }
    if (isSensitivePathKey(key) || looksLikeAbsoluteLocalPath(text)) {
        const fileName = basename(text);
        return fileName ? `[local-path-redacted]/${fileName}` : '[local-path-redacted]';
    }
    return text;
}

function sanitizeSkuPublicValue(value: unknown, key?: string): unknown {
    if (typeof value === 'string') return sanitizePublicString(value, key);
    if (Array.isArray(value)) return value.map((item) => sanitizeSkuPublicValue(item, key));
    if (!value || typeof value !== 'object') return value;
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
        output[entryKey] = sanitizeSkuPublicValue(entryValue, entryKey);
    }
    return output;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

export function sanitizeSkuToolResultsForPublicResult(
    toolResults: SkuPublicToolResult[] = []
): SkuPublicToolResult[] {
    return toolResults.map((entry) => ({
        toolName: entry?.toolName ? String(entry.toolName) : undefined,
        result: sanitizeSkuPublicValue(entry?.result)
    }));
}

export function buildSkuExportReadback(
    input: BuildSkuExportReadbackInput
): SkuExportReadback {
    const explicitExpectedExports = (input.expectedExports || [])
        .map((item) => ({
            path: String(item?.path || '').trim(),
            expectedDimensions: normalizeExpectedDimensions(item?.expectedDimensions)
        }))
        .filter((item) => Boolean(item.path));
    const expectedExportPaths = Array.from(new Set((explicitExpectedExports.length > 0
        ? explicitExpectedExports.map((item) => item.path)
        : (input.expectedExportPaths || []))
        .map((item) => String(item || '').trim())
        .filter(Boolean)));
    const expectedFileNames = Array.from(new Set(expectedExportPaths.map(basename).filter(Boolean)));
    const globalExpectedDimensions = normalizeExpectedDimensions(input.expectedDimensions);
    const expectedDimensionsByPath = new Map<string, { width: number; height: number }>();
    const expectedDimensionsByFileName = new Map<string, { width: number; height: number }>();
    for (const item of explicitExpectedExports) {
        if (!item.expectedDimensions) continue;
        expectedDimensionsByPath.set(normalizePathKey(item.path), item.expectedDimensions);
        expectedDimensionsByFileName.set(basename(item.path).toLowerCase(), item.expectedDimensions);
    }
    const getExpectedDimensionsForProbe = (probe: SkuExportFileProbeInput): { width: number; height: number } | undefined => {
        const pathKey = normalizePathKey(probe?.path);
        if (pathKey && expectedDimensionsByPath.has(pathKey)) {
            return expectedDimensionsByPath.get(pathKey);
        }
        const fileNameKey = basename(probe?.path).toLowerCase();
        if (fileNameKey && expectedDimensionsByFileName.has(fileNameKey)) {
            return expectedDimensionsByFileName.get(fileNameKey);
        }
        return globalExpectedDimensions;
    };
    const fileProbes = (input.fileProbes || []).map((probe) => sanitizeProbe(probe, getExpectedDimensionsForProbe(probe)));
    const failedProbes = fileProbes.filter((probe) => !probe.success);
    const dimensionMismatchProbes = fileProbes.filter((probe) => hasDimensionMismatch(probe));
    const finalImageMetricBlockers = uniqueStrings(fileProbes
        .map(getFinalImageMetricBlocker)
        .filter(Boolean) as string[]);
    const missingVisualMetricCount = fileProbes.filter((probe) => probe.success && !probe.visualMetrics).length;
    const missingFileProbeCount = Math.max(0, expectedExportPaths.length - fileProbes.length);
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (expectedExportPaths.length === 0) {
        warnings.push('SKU 工具没有返回导出文件路径，无法进行文件读回。');
    }
    if (missingFileProbeCount > 0) {
        blockers.push(`缺少 ${missingFileProbeCount} 个 SKU 导出文件探针。`);
    }
    if (failedProbes.length > 0) {
        blockers.push(`导出文件探针失败 ${failedProbes.length} 个：${failedProbes.map((probe) => probe.fileName).join('、')}`);
    }
    if (dimensionMismatchProbes.length > 0) {
        blockers.push(`导出文件尺寸不符合预期 ${dimensionMismatchProbes.length} 个：${dimensionMismatchProbes.map((probe) => probe.fileName).join('、')}`);
    }
    blockers.push(...finalImageMetricBlockers);
    if (missingVisualMetricCount > 0) {
        warnings.push(`有 ${missingVisualMetricCount} 个导出文件缺少 visualMetrics，只能确认文件存在、可解码和尺寸，无法做最终图片像素验收。`);
    }

    const status: SkuExportReadbackStatus = expectedExportPaths.length === 0
        ? 'no_exports'
        : blockers.length > 0
            ? (failedProbes.length > 0 || dimensionMismatchProbes.length > 0 || finalImageMetricBlockers.length > 0 ? 'blocked' : 'needs_file_probe')
            : 'ready_for_review';

    return {
        version: 'sku-export-readback/v0',
        status,
        expectedExportCount: expectedExportPaths.length,
        fileProbeCount: fileProbes.length,
        okFileProbeCount: fileProbes.filter((probe) => probe.success).length,
        failedFileProbeCount: failedProbes.length + dimensionMismatchProbes.length,
        missingFileProbeCount,
        dimensionMismatchCount: dimensionMismatchProbes.length,
        visualMetricBlockerCount: finalImageMetricBlockers.length,
        resultFileNames: expectedFileNames,
        fileProbes,
        blockers,
        warnings,
        boundaries: {
            readonly: true,
            rawImagesRedacted: true,
            doesNotClaimDesignQuality: true,
            doesNotRunPhotoshop: true
        }
    };
}
