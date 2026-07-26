/**
 * 局部重绘工具 (Inpainting Tools)
 * 
 * 包含：
 * 1. GetSelectionMaskTool - 获取当前选区作为蒙版
 * 2. ApplyRasterImageResultTool - 应用通用图像结果到图层
 */

import { Tool, ToolSchema } from '../types';
import {
    arrayBufferFromBytes,
    assertImageBytesSafeForPhotoshop,
    bytesFromBase64ImagePayload,
    readFileEntryBytes
} from '../../core/image-safety';
const uxp = require('uxp');

const { app, imaging, action, core } = require('photoshop');
const { batchPlay } = action;
const fs = uxp.storage.localFileSystem;

const READ_ONLY_SELECTION_BATCH_PLAY_OPTIONS = { synchronousExecution: true };

function buildSelectionReadDescriptor(property: 'selection' | 'selectionBounds'): any {
    return {
        _obj: 'get',
        _target: [
            { _property: property },
            { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }
        ],
        _options: { dialogOptions: 'dontDisplay' }
    };
}

function getLayerBoundsNoEffects(layer: any): any {
    return layer?.boundsNoEffects || layer?.bounds;
}

async function translateLayer(layer: any, offsetX: number, offsetY: number): Promise<void> {
    if (typeof layer?.translate !== 'function') {
        throw new Error('ApplyRasterImageResult failed: placed raster result layer does not support DOM translate; native move is blocked to avoid Photoshop popups.');
    }
    await Promise.resolve(layer.translate(offsetX, offsetY));
}

function toErrorMessage(error: any): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object') {
        const message = (error as any).message || (error as any).reason;
        if (message) return String(message);
    }
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== '{}' && serialized !== 'null') return serialized;
    } catch {}
    return '获取选区蒙版失败（Photoshop 返回空错误）';
}

/**
 * 将 Uint8Array 转换为 Base64（分块处理避免栈溢出）
 * 使用显式 & 0xFF 确保每个字节在 Latin1 范围内，避免 btoa InvalidCharacterError
 */
function uint8ArrayToBase64(data: Uint8Array): string {
    const CHUNK_SIZE = 32768;
    let binary = '';
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length));
        for (let j = 0; j < chunk.length; j++) {
            binary += String.fromCharCode(chunk[j] & 0xFF);
        }
    }
    return btoa(binary);
}

/** 清洗 base64 字符串，移除非法字符，避免 atob InvalidCharacterError */
function sanitizeBase64(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[^A-Za-z0-9+/=]/g, '');
}

function decodeBase64Bytes(input: string): Uint8Array {
    const base64Data = sanitizeBase64(input);
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function extensionFromPath(filePath: string): string {
    const match = String(filePath || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

const PHOTOSHOP_16BIT_MAX = 32768;

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
        const source = data as Uint16Array;
        return Math.max(0, Math.min(255, Math.round((source[index] / PHOTOSHOP_16BIT_MAX) * 255)));
    }
    if (componentSize === 32) {
        const source = data as Float32Array;
        return Math.max(0, Math.min(255, Math.round(source[index] * 255)));
    }
    const source = data as Uint8Array;
    return source[index] || 0;
}

function normalizePixelsTo8Bit(
    data: Uint8Array | Uint16Array | Float32Array,
    pixelCount: number,
    components: number,
    componentSize: number,
    outputComponents: 1 | 3
): Uint8Array {
    const output = new Uint8Array(pixelCount * outputComponents);
    for (let i = 0; i < pixelCount; i++) {
        const src = i * components;
        const dst = i * outputComponents;
        if (outputComponents === 1) {
            output[dst] = sampleTo8Bit(data, src, componentSize);
        } else {
            output[dst] = sampleTo8Bit(data, src, componentSize);
            output[dst + 1] = sampleTo8Bit(data, src + 1, componentSize);
            output[dst + 2] = sampleTo8Bit(data, src + 2, componentSize);
        }
    }
    return output;
}

function normalizePixelsToRgba8(
    data: Uint8Array | Uint16Array | Float32Array,
    pixelCount: number,
    components: number,
    componentSize: number
): Uint8ClampedArray {
    const output = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
        const src = i * components;
        const dst = i * 4;
        const red = sampleTo8Bit(data, src, componentSize);
        output[dst] = red;
        output[dst + 1] = components > 1 ? sampleTo8Bit(data, src + 1, componentSize) : red;
        output[dst + 2] = components > 2 ? sampleTo8Bit(data, src + 2, componentSize) : red;
        output[dst + 3] = components > 3 ? sampleTo8Bit(data, src + 3, componentSize) : 255;
    }
    return output;
}

async function getDocumentPixelSpec(docId: number): Promise<{
    componentSize: number;
    colorProfile: string;
}> {
    const probe = await imaging.getPixels({
        documentID: docId,
        targetSize: { width: 1, height: 1 },
        applyAlpha: true
    });
    try {
        return {
            componentSize: probe.imageData.componentSize || 8,
            colorProfile: probe.imageData.colorProfile || 'sRGB IEC61966-2.1'
        };
    } finally {
        probe.imageData.dispose();
    }
}

function convertRgba8ToTargetDepth(
    bytes: Uint8Array,
    componentSize: number
): Uint8Array | Uint16Array | Float32Array {
    if (componentSize === 16) {
        const converted = new Uint16Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            converted[i] = Math.max(0, Math.min(PHOTOSHOP_16BIT_MAX, Math.round((bytes[i] / 255) * PHOTOSHOP_16BIT_MAX)));
        }
        return converted;
    }
    if (componentSize === 32) {
        const converted = new Float32Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            converted[i] = bytes[i] / 255;
        }
        return converted;
    }
    return bytes;
}

/**
 * 获取当前选区作为蒙版
 */
export class GetSelectionMaskTool implements Tool {
    name = 'getSelectionMask';
    
    schema: ToolSchema = {
        name: 'getSelectionMask',
        description: '获取当前 Photoshop 选区作为蒙版（用于局部重绘）',
        parameters: {
            type: 'object',
            properties: {
                includeImage: {
                    type: 'boolean',
                    description: '是否同时返回原图像（默认 true）'
                },
                maxSize: {
                    type: 'number',
                    description: '最大尺寸（默认 1024）'
                }
            }
        }
    };

    async execute(params: { includeImage?: boolean; maxSize?: number }): Promise<any> {
        const includeImage = params.includeImage !== false;
        const maxSize = params.maxSize || 1024;

        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 检查是否有选区
            const hasSelection = await this.checkSelection();
            if (!hasSelection) {
                return { success: false, error: '请先创建选区（使用套索工具、矩形选框等）' };
            }

            const width = doc.width as number;
            const height = doc.height as number;

            // 计算缩放比例
            const scale = Math.min(1, maxSize / Math.max(width, height));
            const targetWidth = Math.round(width * scale);
            const targetHeight = Math.round(height * scale);

            console.log(`[GetSelectionMask] 文档尺寸: ${width}x${height}, 目标尺寸: ${targetWidth}x${targetHeight}`);

            const selectionBounds = await this.getSelectionBounds();
            if (!selectionBounds) {
                return { success: false, error: '无法获取选区边界' };
            }

            let scaledSelectionBounds = {
                left: Math.round(selectionBounds.left * scale),
                top: Math.round(selectionBounds.top * scale),
                right: Math.round(selectionBounds.right * scale),
                bottom: Math.round(selectionBounds.bottom * scale)
            };

            let maskBase64 = '';
            let imageBase64 = '';
            let actualMaskWidth = targetWidth;
            let actualMaskHeight = targetHeight;
            let actualImageWidth = 0;
            let actualImageHeight = 0;

            // 使用 PS 原生 API 获取选区蒙版和文档图像（零历史副作用）
            await core.executeAsModal(async () => {
                // 1. 用 imaging.getSelection() 直接获取选区蒙版（灰度单通道）
                const selResult = await imaging.getSelection({
                    documentID: doc.id,
                    targetSize: { width: targetWidth, height: targetHeight }
                });
                const maskDataRaw = await selResult.imageData.getData() as Uint8Array | Uint16Array | Float32Array;
                const maskData = coerceTypedPixelData(maskDataRaw, selResult.imageData.componentSize);
                const maskBytes = normalizePixelsTo8Bit(
                    maskData,
                    selResult.imageData.width * selResult.imageData.height,
                    selResult.imageData.components,
                    selResult.imageData.componentSize,
                    1
                );
                actualMaskWidth = selResult.imageData.width;
                actualMaskHeight = selResult.imageData.height;
                maskBase64 = uint8ArrayToBase64(maskBytes);
                console.log(`[GetSelectionMask] 蒙版: ${selResult.imageData.width}x${selResult.imageData.height}, channels=${selResult.imageData.components}, componentSize=${selResult.imageData.componentSize}, encoded=raw-gray-base64`);
                selResult.imageData.dispose();

                // 2. 获取文档复合图像并标准化为 RGBA raw，交给 Agent 用 sharp 转 PNG，
                // 避免依赖 UXP Canvas / ImageData 兼容性，同时保留无损像素。
                if (includeImage) {
                    const imgResult = await imaging.getPixels({
                        documentID: doc.id,
                        targetSize: { width: targetWidth, height: targetHeight },
                        applyAlpha: true  // 返回 RGB（无 alpha），白底合成
                    });
                    const imgDataRaw = await imgResult.imageData.getData() as Uint8Array | Uint16Array | Float32Array;
                    const imgData = coerceTypedPixelData(imgDataRaw, imgResult.imageData.componentSize);
                    const rgbaBytes = normalizePixelsToRgba8(
                        imgData,
                        imgResult.imageData.width * imgResult.imageData.height,
                        imgResult.imageData.components,
                        imgResult.imageData.componentSize
                    );
                    actualImageWidth = imgResult.imageData.width;
                    actualImageHeight = imgResult.imageData.height;
                    imageBase64 = uint8ArrayToBase64(new Uint8Array(rgbaBytes.buffer));
                    console.log(`[GetSelectionMask] 图像: ${imgResult.imageData.width}x${imgResult.imageData.height}, channels=${imgResult.imageData.components}, componentSize=${imgResult.imageData.componentSize}, encoded=raw-rgba-base64`);
                    imgResult.imageData.dispose();
                }
            }, { commandName: 'DesignEcho: 获取选区蒙版' });

            if (!maskBase64) {
                throw new Error('选区蒙版为空，请重新创建选区后重试');
            }

            if (includeImage && actualImageWidth > 0 && actualImageHeight > 0) {
                if (actualImageWidth !== actualMaskWidth || actualImageHeight !== actualMaskHeight) {
                    throw new Error(`图像与蒙版尺寸不一致: image=${actualImageWidth}x${actualImageHeight}, mask=${actualMaskWidth}x${actualMaskHeight}`);
                }
            }

            const effectiveWidth = actualMaskWidth;
            const effectiveHeight = actualMaskHeight;
            const effectiveScaleX = effectiveWidth / width;
            const effectiveScaleY = effectiveHeight / height;
            scaledSelectionBounds = {
                left: Math.round(selectionBounds.left * effectiveScaleX),
                top: Math.round(selectionBounds.top * effectiveScaleY),
                right: Math.round(selectionBounds.right * effectiveScaleX),
                bottom: Math.round(selectionBounds.bottom * effectiveScaleY)
            };

            const result: any = {
                success: true,
                mask: maskBase64,
                maskFormat: 'raw',
                maskChannels: 1,
                width: effectiveWidth,
                height: effectiveHeight,
                originalWidth: width,
                originalHeight: height,
                selectionBounds: scaledSelectionBounds,
                documentMeta: {
                    width,
                    height,
                    scale: Math.min(effectiveScaleX, effectiveScaleY),
                    selectionBoundsOriginal: selectionBounds
                }
            };

            if (includeImage) {
                result.image = imageBase64;
                result.imageFormat = 'raw';
                result.imageChannels = 4;
            }

            console.log(`[GetSelectionMask] 获取成功 (mask=${result.maskFormat}, image=${result.imageFormat || 'none'})`);
            return result;

        } catch (error: any) {
            const errorMessage = toErrorMessage(error);
            console.error('[GetSelectionMask] 错误:', errorMessage);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * 检查是否有活动选区（同时返回边界，避免重复查询）
     */
    private async checkSelection(): Promise<boolean> {
        // 使用 getSelectionBounds 做统一判断：有边界 = 有选区
        const bounds = await this.getSelectionBounds();
        return bounds !== null;
    }

    private async getSelectionBounds(): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
        try {
            const result = await batchPlay([
                buildSelectionReadDescriptor('selection')
            ], READ_ONLY_SELECTION_BATCH_PLAY_OPTIONS);

            const selection = result?.[0]?.selection;
            if (!selection) {
                return null;
            }

            // 必须同时有四个边界值才算有效选区
            const left = selection.left?._value ?? selection.left;
            const top = selection.top?._value ?? selection.top;
            const right = selection.right?._value ?? selection.right;
            const bottom = selection.bottom?._value ?? selection.bottom;

            if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
                return null;
            }

            const l = Math.round(Number(left));
            const t = Math.round(Number(top));
            const r = Math.round(Number(right));
            const b = Math.round(Number(bottom));

            // 选区宽高必须 > 0
            if (r <= l || b <= t) {
                return null;
            }

            // 排除"全画布选区"（无选区时 PS 返回全文档边界，不是用户创建的真实选区）
            const doc = app.activeDocument;
            if (doc) {
                const docW = doc.width as number;
                const docH = doc.height as number;
                if (l <= 0 && t <= 0 && r >= docW && b >= docH) {
                    console.log('[GetSelectionMask] 检测到全画布选区，视为无选区');
                    return null;
                }
            }

            return { left: l, top: t, right: r, bottom: b };
        } catch {
            return null;
        }
    }

    /**
     * 将像素数据转换为 Base64
     */
    private async pixelDataToBase64(data: Uint8Array, width: number, height: number, isGrayscale: boolean): Promise<string> {
        const pixelCount = width * height;
        const rgb = new Uint8Array(pixelCount * 3);

        if (isGrayscale) {
            // 灰度图 -> RGB
            for (let i = 0; i < pixelCount; i++) {
                const gray = data[i * 4] || 0; // 取第一个通道
                const offset = i * 3;
                rgb[offset] = gray;
                rgb[offset + 1] = gray;
                rgb[offset + 2] = gray;
            }
        } else {
            // RGBA -> RGB（UXP encodeImageData 仅支持 JPEG，不能含 alpha）
            for (let i = 0; i < pixelCount; i++) {
                const src = i * 4;
                const dst = i * 3;
                rgb[dst] = data[src] || 0;
                rgb[dst + 1] = data[src + 1] || 0;
                rgb[dst + 2] = data[src + 2] || 0;
            }
        }

        // UXP 环境没有 OffscreenCanvas，使用 Photoshop Imaging API 编码
        const imageDataObj = await imaging.createImageDataFromBuffer(rgb, {
            width,
            height,
            components: 3,
            colorSpace: 'RGB',
            colorProfile: 'sRGB IEC61966-2.1'
        });

        try {
            const encoded = await imaging.encodeImageData({
                imageData: imageDataObj,
                base64: true
            });

            if (typeof encoded === 'string') {
                return encoded;
            }

            // 兼容返回 number[] 的情况
            const bytes = new Uint8Array(encoded as number[]);
            return uint8ArrayToBase64(bytes);
        } finally {
            imageDataObj.dispose();
        }
    }

}

/**
 * Apply a raster image result.
 */
export class ApplyRasterImageResultTool implements Tool {
    name = 'applyRasterImageResult';

    schema: ToolSchema = {
        name: 'applyRasterImageResult',
        description: 'Apply a raster image result onto a new Photoshop layer.',
        parameters: {
            type: 'object',
            properties: {
                imageData: {
                    type: 'string',
                    description: 'Base64-encoded image payload.'
                },
                filePath: {
                    type: 'string',
                    description: 'Optional local file path to a raster image result.'
                },
                layerName: {
                    type: 'string',
                    description: 'Optional destination layer name.'
                },
                width: {
                    type: 'number',
                    description: 'Result width in pixels.'
                },
                height: {
                    type: 'number',
                    description: 'Result height in pixels.'
                },
                placementWidth: {
                    type: 'number',
                    description: 'Target width for placement on canvas.'
                },
                placementHeight: {
                    type: 'number',
                    description: 'Target height for placement on canvas.'
                },
                originalWidth: {
                    type: 'number',
                    description: 'Original document width.'
                },
                originalHeight: {
                    type: 'number',
                    description: 'Original document height.'
                },
                targetBounds: {
                    type: 'object',
                    description: 'Destination top-left position.',
                    properties: {
                        left: { type: 'number', description: 'Target left coordinate.' },
                        top: { type: 'number', description: 'Target top coordinate.' }
                    }
                }
            },
            required: ['imageData']
        }
    };

    async execute(params: { imageData: string; filePath?: string; imageBytes?: Uint8Array; imageFormat?: string; isRawRgba?: boolean; layerName?: string; width?: number; height?: number; placementWidth?: number; placementHeight?: number; originalWidth?: number; originalHeight?: number; targetBounds?: { left?: number; top?: number } }): Promise<any> {
        const layerName = params.layerName || '图像结果';
        let createdLayerId: number | null = null;

        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let bytes: Uint8Array | undefined;
            let encodedFormatHint = params.imageFormat;
            const hasFilePath = typeof params.filePath === 'string' && params.filePath.length > 0;
            const isRaw = params.isRawRgba === true;
            if (params.imageBytes instanceof Uint8Array) {
                bytes = params.imageBytes;
            } else if (!hasFilePath) {
                if (isRaw) {
                    const rawPayload = (params.imageData || '').replace(/^data:[^;]+;base64,/, '');
                    bytes = decodeBase64Bytes(rawPayload);
                } else {
                    const decoded = bytesFromBase64ImagePayload(params.imageData || '');
                    bytes = decoded.bytes;
                    encodedFormatHint = encodedFormatHint || decoded.mimeType;
                }
            }

            if (!isRaw && bytes) {
                assertImageBytesSafeForPhotoshop(bytes, {
                    formatHint: encodedFormatHint,
                    sourceLabel: `局部重绘结果「${layerName}」`
                });
            }

            const docWidth = doc.width as number;
            const docHeight = doc.height as number;
            const imgWidth = params.width || docWidth;
            const imgHeight = params.height || docHeight;
            const placementWidth = params.placementWidth || imgWidth;
            const placementHeight = params.placementHeight || imgHeight;
            const expectedSize = imgWidth * imgHeight * 4;

            console.log(`[ApplyRasterImageResult] image=${imgWidth}x${imgHeight}, placement=${placementWidth}x${placementHeight}, doc=${docWidth}x${docHeight}, isRaw=${isRaw}, hasFilePath=${hasFilePath}, bytes=${bytes?.length || 0}, expected=${expectedSize}`);

            if (isRaw && (!bytes || bytes.length !== expectedSize)) {
                return {
                    success: false,
                    error: `Pixel payload size mismatch: got ${bytes?.length || 0}, expected ${expectedSize} (${imgWidth}x${imgHeight}x4)`
                };
            }

            await core.executeAsModal(async () => {
                if (!isRaw) {
                    const storage = uxp.storage;
                    let fileEntry: any = null;
                    let createdTempFile: any = null;

                    try {
                        if (hasFilePath) {
                            try {
                                fileEntry = await fs.getEntryWithUrl('file://' + params.filePath!.replace(/\\/g, '/'));
                            } catch (pathError) {
                                fileEntry = await fs.getEntryWithUrl(params.filePath!);
                            }
                            const fileBytes = await readFileEntryBytes(fileEntry, storage);
                            assertImageBytesSafeForPhotoshop(fileBytes, {
                                formatHint: params.imageFormat || extensionFromPath(params.filePath!),
                                sourceLabel: `图像结果文件「${params.filePath!.split(/[\\/]/).pop() || params.filePath}」`
                            });
                        } else {
                            const tempFolder = await fs.getTemporaryFolder();
                            const ext = (params.imageFormat || 'png').replace(/^\./, '') || 'png';
                            const tempFile = await tempFolder.createFile(`inpaint_${Date.now()}.${ext}`, { overwrite: true });
                            await tempFile.write(arrayBufferFromBytes(bytes!), { format: storage.formats.binary });
                            fileEntry = tempFile;
                            createdTempFile = tempFile;
                        }

                        const sessionToken = await fs.createSessionToken(fileEntry);

                        await batchPlay([
                            {
                                _obj: 'placeEvent',
                                null: { _path: sessionToken, _kind: 'local' },
                                freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                                offset: {
                                    _obj: 'offset',
                                    horizontal: { _unit: 'pixelsUnit', _value: 0 },
                                    vertical: { _unit: 'pixelsUnit', _value: 0 }
                                },
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], { synchronousExecution: true });

                        const newLayer = doc.activeLayers?.[0];
                        if (!newLayer) {
                            throw new Error('Failed to place raster image result');
                        }

                        createdLayerId = newLayer.id;
                        newLayer.name = layerName;

                        const initialBounds = getLayerBoundsNoEffects(newLayer);
                        const layerWidth = initialBounds.right - initialBounds.left;
                        const layerHeight = initialBounds.bottom - initialBounds.top;

                        if (layerWidth > 0 && layerHeight > 0) {
                            const scaleW = (placementWidth / layerWidth) * 100;
                            const scaleH = (placementHeight / layerHeight) * 100;
                            if (Math.abs(scaleW - 100) > 0.1 || Math.abs(scaleH - 100) > 0.1) {
                                await batchPlay([
                                    {
                                        _obj: 'transform',
                                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                        freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                                        width: { _unit: 'percentUnit', _value: scaleW },
                                        height: { _unit: 'percentUnit', _value: scaleH },
                                        linked: false,
                                        interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
                                        _options: { dialogOptions: 'dontDisplay' }
                                    }
                                ], {});
                            }
                        }

                        if (params.targetBounds && (typeof params.targetBounds.left === 'number' || typeof params.targetBounds.top === 'number')) {
                            const currentBounds = getLayerBoundsNoEffects(newLayer);
                            const currentX = currentBounds.left;
                            const currentY = currentBounds.top;
                            const targetX = Math.round(params.targetBounds.left || 0);
                            const targetY = Math.round(params.targetBounds.top || 0);
                            const moveX = targetX - currentX;
                            const moveY = targetY - currentY;

                            if (moveX !== 0 || moveY !== 0) {
                                await translateLayer(newLayer, moveX, moveY);
                            }
                        }
                    } finally {
                        if (createdTempFile) {
                            try { await createdTempFile.delete(); } catch {}
                        }
                    }

                    return;
                }

                const targetPixelSpec = await getDocumentPixelSpec(doc.id);
                const sourcePixelData = convertRgba8ToTargetDepth(bytes!, targetPixelSpec.componentSize);
                console.log(`[ApplyRasterImageResult] targetPixelSpec=${targetPixelSpec.componentSize}/${targetPixelSpec.colorProfile}`);

                await batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'layer' }],
                        using: { _obj: 'layer', name: layerName },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});

                const newLayer = doc.activeLayers?.[0];
                if (!newLayer) {
                    throw new Error('创建图层失败');
                }
                createdLayerId = newLayer.id;

                const imageDataObj = await imaging.createImageDataFromBuffer(sourcePixelData, {
                    width: imgWidth,
                    height: imgHeight,
                    components: 4,
                    colorSpace: 'RGB',
                    colorProfile: 'sRGB IEC61966-2.1'
                });

                try {
                    await imaging.putPixels({
                        documentID: doc.id,
                        layerID: newLayer.id,
                        imageData: imageDataObj,
                        targetBounds: {
                            left: Math.round(params.targetBounds?.left || 0),
                            top: Math.round(params.targetBounds?.top || 0)
                        }
                    });
                } finally {
                    imageDataObj.dispose();
                }

                const hasExplicitTargetBounds = params.targetBounds
                    && (typeof params.targetBounds.left === 'number' || typeof params.targetBounds.top === 'number');

                if (!hasExplicitTargetBounds
                    && params.originalWidth
                    && params.originalHeight
                    && (Math.abs(imgWidth - params.originalWidth) > 1 || Math.abs(imgHeight - params.originalHeight) > 1)) {
                    const scaleW = (params.originalWidth / imgWidth) * 100;
                    const scaleH = (params.originalHeight / imgHeight) * 100;

                    await batchPlay([
                        {
                            _obj: 'transform',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                            width: { _unit: 'percent', _value: scaleW },
                            height: { _unit: 'percent', _value: scaleH },
                            linked: false,
                            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' }
                        }
                    ], {});
                }
            }, { commandName: 'DesignEcho: 应用图像结果' });

            return {
                success: true,
                layerName,
                layerId: createdLayerId,
                writeMode: 'new-layer',
                sourceDocumentPreserved: true
            };

        } catch (error: any) {
            const errorMessage =
                error?.message
                || (typeof error === 'string' ? error : '')
                || (() => {
                    try {
                        return JSON.stringify(error);
                    } catch {
                        return '';
                    }
                })()
                || 'Unknown error';
            console.error('[ApplyRasterImageResult] Error:', errorMessage, error);
            return { success: false, error: errorMessage };
        }
    }
}

/**
 * Get current selection bounds.
 */
export class GetSelectionBoundsTool implements Tool {
    name = 'getSelectionBounds';

    schema: ToolSchema = {
        name: 'getSelectionBounds',
        description: 'Get the current Photoshop selection bounds.',
        parameters: {
            type: 'object',
            properties: {}
        }
    };

    async execute(): Promise<any> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: 'No active document', hasSelection: false };
            }

            const result = await batchPlay([
                buildSelectionReadDescriptor('selection')
            ], READ_ONLY_SELECTION_BATCH_PLAY_OPTIONS);

            if (!result[0] || !result[0].selection) {
                return {
                    success: false,
                    error: 'Please create a selection first',
                    hasSelection: false
                };
            }

            const selection = result[0].selection;
            let bounds: { left: number; top: number; right: number; bottom: number } | null = null;

            if (selection.left !== undefined && selection.top !== undefined) {
                bounds = {
                    left: Math.round(selection.left._value || selection.left),
                    top: Math.round(selection.top._value || selection.top),
                    right: Math.round(selection.right._value || selection.right),
                    bottom: Math.round(selection.bottom._value || selection.bottom)
                };
            } else {
                const boundsResult = await batchPlay([
                    buildSelectionReadDescriptor('selectionBounds')
                ], READ_ONLY_SELECTION_BATCH_PLAY_OPTIONS);

                if (boundsResult[0] && boundsResult[0].selectionBounds) {
                    const sb = boundsResult[0].selectionBounds;
                    bounds = {
                        left: Math.round(sb.left._value || sb.left || 0),
                        top: Math.round(sb.top._value || sb.top || 0),
                        right: Math.round(sb.right._value || sb.right || 0),
                        bottom: Math.round(sb.bottom._value || sb.bottom || 0)
                    };
                }
            }

            if (!bounds) {
                return {
                    success: false,
                    error: 'Unable to resolve selection bounds',
                    hasSelection: true
                };
            }

            const width = bounds.right - bounds.left;
            const height = bounds.bottom - bounds.top;

            return {
                success: true,
                hasSelection: true,
                bounds,
                box: [bounds.left, bounds.top, bounds.right, bounds.bottom],
                width,
                height,
                documentWidth: doc.width as number,
                documentHeight: doc.height as number
            };
        } catch (error: any) {
            console.error('[GetSelectionBounds] Error:', error?.message || error);
            return { success: false, error: error?.message || String(error), hasSelection: false };
        }
    }
}
