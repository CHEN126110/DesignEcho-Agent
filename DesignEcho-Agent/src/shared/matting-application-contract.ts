export const MATTING_MAX_OUTPUT_PIXELS = 100_000_000;

export type MattingEdgeRefineMode = 'none' | 'light' | 'standard' | 'hair' | 'product-hard';

export interface MattingOutputGeometry {
    width: number;
    height: number;
    pixelCount: number;
}

export interface MattingEdgeRefineOptions {
    enableHairRefine?: boolean;
    enableFabricRefine?: boolean;
    refineEdges?: boolean;
}

function normalizePositiveDimension(value: unknown): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }
    return Math.max(1, Math.round(numeric));
}

export function resolveMattingOutputGeometry(
    width: unknown,
    height: unknown,
    maxPixels: number = MATTING_MAX_OUTPUT_PIXELS
): MattingOutputGeometry | null {
    const normalizedWidth = normalizePositiveDimension(width);
    const normalizedHeight = normalizePositiveDimension(height);
    if (!normalizedWidth || !normalizedHeight) {
        return null;
    }

    const pixelCount = normalizedWidth * normalizedHeight;
    if (!Number.isSafeInteger(pixelCount) || pixelCount > maxPixels) {
        throw new RangeError(
            `目标图层 ${normalizedWidth}×${normalizedHeight} 超过本地抠图的安全输出上限，` +
            `请缩小图层或分区处理后重试。`
        );
    }

    return {
        width: normalizedWidth,
        height: normalizedHeight,
        pixelCount
    };
}

export function resolveMattingEdgeRefineMode(
    options: MattingEdgeRefineOptions,
    fallback: 'standard' | 'product-hard' = 'product-hard'
): MattingEdgeRefineMode {
    if (options.enableHairRefine === true || options.enableFabricRefine === true) {
        // 现有 hair profile 是软 Alpha 保护档，同时适合发丝、蕾丝和织物飞边。
        return 'hair';
    }
    if (options.refineEdges === false) {
        return 'none';
    }
    return fallback;
}

export function assertRawMaskGeometry(byteLength: number, width: number, height: number): void {
    const geometry = resolveMattingOutputGeometry(width, height);
    if (!geometry) {
        throw new Error('蒙版没有有效的宽高信息，无法应用到 Photoshop。');
    }
    if (byteLength !== geometry.pixelCount) {
        throw new Error(
            `蒙版数据不完整：收到 ${byteLength} bytes，` +
            `但 ${geometry.width}×${geometry.height} 单通道蒙版需要 ${geometry.pixelCount} bytes。`
        );
    }
}
