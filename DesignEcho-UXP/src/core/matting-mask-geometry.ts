export const MATTING_COMPAT_RESIZE_MAX_PIXELS = 4_000_000;

export type MattingMaskApplyPlan =
    | { mode: 'exact'; targetWidth: number; targetHeight: number }
    | { mode: 'compat-bilinear'; targetWidth: number; targetHeight: number }
    | { mode: 'reject-large-mismatch'; targetWidth: number; targetHeight: number };

function normalizeDimension(value: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error(`无效的蒙版尺寸：${value}`);
    }
    return Math.max(1, Math.round(numeric));
}

export function resolveMattingMaskApplyPlan(
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    compatResizeMaxPixels: number = MATTING_COMPAT_RESIZE_MAX_PIXELS
): MattingMaskApplyPlan {
    const normalizedSourceWidth = normalizeDimension(sourceWidth);
    const normalizedSourceHeight = normalizeDimension(sourceHeight);
    const normalizedTargetWidth = normalizeDimension(targetWidth);
    const normalizedTargetHeight = normalizeDimension(targetHeight);

    if (
        normalizedSourceWidth === normalizedTargetWidth &&
        normalizedSourceHeight === normalizedTargetHeight
    ) {
        return {
            mode: 'exact',
            targetWidth: normalizedTargetWidth,
            targetHeight: normalizedTargetHeight
        };
    }

    const targetPixelCount = normalizedTargetWidth * normalizedTargetHeight;
    if (targetPixelCount <= compatResizeMaxPixels) {
        return {
            mode: 'compat-bilinear',
            targetWidth: normalizedTargetWidth,
            targetHeight: normalizedTargetHeight
        };
    }

    return {
        mode: 'reject-large-mismatch',
        targetWidth: normalizedTargetWidth,
        targetHeight: normalizedTargetHeight
    };
}

export function resizeGrayscaleMaskBilinear(
    source: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number
): Uint8Array {
    const normalizedSourceWidth = normalizeDimension(sourceWidth);
    const normalizedSourceHeight = normalizeDimension(sourceHeight);
    const normalizedTargetWidth = normalizeDimension(targetWidth);
    const normalizedTargetHeight = normalizeDimension(targetHeight);
    const expectedSourceLength = normalizedSourceWidth * normalizedSourceHeight;
    if (source.byteLength !== expectedSourceLength) {
        throw new Error(
            `蒙版数据长度不匹配：收到 ${source.byteLength} bytes，需要 ${expectedSourceLength} bytes。`
        );
    }

    const target = new Uint8Array(normalizedTargetWidth * normalizedTargetHeight);
    const xRatio = normalizedSourceWidth / normalizedTargetWidth;
    const yRatio = normalizedSourceHeight / normalizedTargetHeight;

    for (let y = 0; y < normalizedTargetHeight; y++) {
        const sourceY = Math.max(0, Math.min(normalizedSourceHeight - 1, (y + 0.5) * yRatio - 0.5));
        const y0 = Math.floor(sourceY);
        const y1 = Math.min(y0 + 1, normalizedSourceHeight - 1);
        const yFraction = sourceY - y0;
        const row0 = y0 * normalizedSourceWidth;
        const row1 = y1 * normalizedSourceWidth;

        for (let x = 0; x < normalizedTargetWidth; x++) {
            const sourceX = Math.max(0, Math.min(normalizedSourceWidth - 1, (x + 0.5) * xRatio - 0.5));
            const x0 = Math.floor(sourceX);
            const x1 = Math.min(x0 + 1, normalizedSourceWidth - 1);
            const xFraction = sourceX - x0;
            const top = source[row0 + x0] * (1 - xFraction) + source[row0 + x1] * xFraction;
            const bottom = source[row1 + x0] * (1 - xFraction) + source[row1 + x1] * xFraction;
            target[y * normalizedTargetWidth + x] = Math.round(
                top * (1 - yFraction) + bottom * yFraction
            );
        }
    }

    return target;
}
