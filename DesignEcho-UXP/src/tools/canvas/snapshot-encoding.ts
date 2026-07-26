const { imaging } = require('photoshop');

const PHOTOSHOP_16BIT_MAX = 32768;

export interface EncodedSnapshot {
    base64: string;
    width: number;
    height: number;
    format: 'jpeg';
}

export function toSnapshotErrorMessage(error: unknown, fallback = '获取快照失败'): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object') {
        const record = error as Record<string, unknown>;
        const message = record.message || record.reason;
        if (message) return String(message);
    }
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== '{}' && serialized !== 'null') return serialized;
    } catch {}
    return fallback;
}

function coerceTypedPixelData(
    data: Uint8Array | Uint16Array | Float32Array,
    componentSize: number
): Uint8Array | Uint16Array | Float32Array {
    if (componentSize === 16) {
        return data instanceof Uint16Array
            ? data
            : new Uint16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
    }
    if (componentSize === 32) {
        return data instanceof Float32Array
            ? data
            : new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    }
    return data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function sampleTo8Bit(
    data: Uint8Array | Uint16Array | Float32Array,
    index: number,
    componentSize: number
): number {
    if (componentSize === 16) {
        return Math.max(0, Math.min(255, Math.round(((data as Uint16Array)[index] / PHOTOSHOP_16BIT_MAX) * 255)));
    }
    if (componentSize === 32) {
        return Math.max(0, Math.min(255, Math.round((data as Float32Array)[index] * 255)));
    }
    return (data as Uint8Array)[index] ?? 0;
}

function normalizePixelsToRgba8(
    data: Uint8Array | Uint16Array | Float32Array,
    pixelCount: number,
    components: number,
    componentSize: number
): Uint8Array {
    const expectedLength = pixelCount * components;
    if (data.length < expectedLength) {
        throw new Error(`快照像素数据不完整：期望 ${expectedLength} 个分量，实际 ${data.length} 个。`);
    }

    const output = new Uint8Array(pixelCount * 4);
    for (let index = 0; index < pixelCount; index++) {
        const sourceOffset = index * components;
        const targetOffset = index * 4;
        const first = sampleTo8Bit(data, sourceOffset, componentSize);
        if (components <= 2) {
            output[targetOffset] = first;
            output[targetOffset + 1] = first;
            output[targetOffset + 2] = first;
            output[targetOffset + 3] = components === 2
                ? sampleTo8Bit(data, sourceOffset + 1, componentSize)
                : 255;
            continue;
        }
        output[targetOffset] = first;
        output[targetOffset + 1] = sampleTo8Bit(data, sourceOffset + 1, componentSize);
        output[targetOffset + 2] = sampleTo8Bit(data, sourceOffset + 2, componentSize);
        output[targetOffset + 3] = components === 4
            ? sampleTo8Bit(data, sourceOffset + 3, componentSize)
            : 255;
    }
    return output;
}

function compositeRgbaOnWhite(rgba: Uint8Array): Uint8Array {
    const rgb = new Uint8Array((rgba.length / 4) * 3);
    for (let index = 0; index < rgba.length / 4; index++) {
        const sourceOffset = index * 4;
        const targetOffset = index * 3;
        const alpha = (rgba[sourceOffset + 3] ?? 255) / 255;
        rgb[targetOffset] = Math.round((rgba[sourceOffset] ?? 0) * alpha + 255 * (1 - alpha));
        rgb[targetOffset + 1] = Math.round((rgba[sourceOffset + 1] ?? 0) * alpha + 255 * (1 - alpha));
        rgb[targetOffset + 2] = Math.round((rgba[sourceOffset + 2] ?? 0) * alpha + 255 * (1 - alpha));
    }
    return rgb;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let index = 0; index < bytes.length; index++) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
}

function encodedImageToBase64(encoded: unknown): string {
    if (typeof encoded === 'string') return encoded;
    if (Array.isArray(encoded)) return bytesToBase64(new Uint8Array(encoded));
    if (ArrayBuffer.isView(encoded)) {
        const view = encoded as ArrayBufferView;
        return bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    }
    if (encoded && typeof encoded === 'object') {
        const base64 = (encoded as Record<string, unknown>).base64;
        if (typeof base64 === 'string') return base64;
    }
    throw new Error('imaging.encodeImageData 未返回 base64 数据');
}

export async function encodePhotoshopImageDataAsJpeg(
    imageData: any,
    fallbackWidth: number,
    fallbackHeight: number
): Promise<EncodedSnapshot> {
    if (!imageData || typeof imageData.getData !== 'function') {
        throw new Error('Photoshop 未返回可读取的快照像素数据');
    }

    const width = Number(imageData.width) || fallbackWidth;
    const height = Number(imageData.height) || fallbackHeight;
    const components = Number(imageData.components) || 4;
    const componentSize = Number(imageData.componentSize) || 8;
    if (width <= 0 || height <= 0) {
        throw new Error(`快照尺寸无效：${width}x${height}`);
    }
    if (![8, 16, 32].includes(componentSize)) {
        throw new Error(`不支持的 Photoshop 像素位深：${componentSize}`);
    }
    if (components < 1 || components > 4) {
        throw new Error(`不支持的 Photoshop 像素分量数：${components}`);
    }

    const rawData = await imageData.getData() as Uint8Array | Uint16Array | Float32Array;
    const typedData = coerceTypedPixelData(rawData, componentSize);
    const rgba = normalizePixelsToRgba8(typedData, width * height, components, componentSize);
    const rgb = compositeRgbaOnWhite(rgba);
    const normalizedImageData = await imaging.createImageDataFromBuffer(rgb, {
        width,
        height,
        components: 3,
        colorSpace: 'RGB',
        colorProfile: 'sRGB IEC61966-2.1',
        chunky: true
    });

    try {
        const encoded = await imaging.encodeImageData({
            imageData: normalizedImageData,
            base64: true
        });
        const base64 = encodedImageToBase64(encoded).trim();
        if (!base64) {
            throw new Error('快照编码结果为空');
        }
        return { base64, width, height, format: 'jpeg' };
    } finally {
        normalizedImageData.dispose();
    }
}
