import { Tool, ToolSchema } from '../types';
import { toNumber } from '../layout/layer-utils';

const { app, core, imaging } = require('photoshop');

export interface RectInput {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface ImageBounds extends RectInput {
    width: number;
    height: number;
}

export interface GetOptimizedImageParams {
    documentId?: number;
    layerId?: number;
    boundary?: RectInput;
    maxSize?: number;
    quality?: number;
    includeAlpha?: boolean;
}

export interface OptimizedImageResult {
    success: boolean;
    colorData?: string | null;
    colorEncoding?: 'jpeg' | 'raw_rgb' | null;
    jpegData?: string | null;
    alphaData?: string | null;
    width?: number;
    height?: number;
    requestedBounds?: ImageBounds;
    actualBounds?: ImageBounds;
    documentBounds?: ImageBounds;
    source?: 'layer' | 'document';
    processingTime?: number;
    error?: string;
}

function toBounds(rect: RectInput): ImageBounds {
    const left = toNumber(rect.left);
    const top = toNumber(rect.top);
    const right = toNumber(rect.right);
    const bottom = toNumber(rect.bottom);
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };
}

function encodeBytesToBase64(bytes: Uint8Array): string {
    let binaryString = '';
    for (let i = 0; i < bytes.length; i++) {
        binaryString += String.fromCharCode(bytes[i]);
    }
    return btoa(binaryString);
}

function resolveReturnedEdge(
    bounds: any,
    edgeName: 'right' | 'bottom',
    sizeName: 'width' | 'height',
    origin: number,
    fallbackValue: number
): number {
    if (bounds?.[edgeName] !== undefined) {
        return toNumber(bounds[edgeName]);
    }

    if (bounds?.[sizeName] !== undefined) {
        return origin + toNumber(bounds[sizeName]);
    }

    return fallbackValue;
}

function normalizeReturnedBounds(bounds: any, fallback: ImageBounds): ImageBounds {
    if (!bounds) return fallback;
    const left = bounds.left !== undefined ? toNumber(bounds.left) : fallback.left;
    const top = bounds.top !== undefined ? toNumber(bounds.top) : fallback.top;
    const right = resolveReturnedEdge(bounds, 'right', 'width', left, fallback.right);
    const bottom = resolveReturnedEdge(bounds, 'bottom', 'height', top, fallback.bottom);
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };
}

function findLayerById(container: any, id: number): any {
    for (const layer of container.layers || []) {
        if (layer.id === id) return layer;
        if (layer.layers) {
            const found = findLayerById(layer, id);
            if (found) return found;
        }
    }
    return null;
}

function getLayerPixelBounds(layer: any): ImageBounds {
    const candidate = layer?.boundsNoEffects || layer?.bounds;
    return toBounds({
        left: candidate.left,
        top: candidate.top,
        right: candidate.right,
        bottom: candidate.bottom
    });
}

export class OptimizedImageTransferTool implements Tool {
    name = 'getOptimizedImage';

    schema: ToolSchema = {
        name: 'getOptimizedImage',
        description: '将文档或图层区域导出为压缩图像（供 MCP / Agent 传输），支持缩放、JPEG 与可选 alpha 蒙版。',
        parameters: {
            type: 'object',
            properties: {
                documentId: {
                    type: 'number',
                    description: '文档 ID；省略则使用当前活动文档'
                },
                layerId: {
                    type: 'number',
                    description: '图层 ID；省略则使用当前选中图层，若无选中图层则使用文档画布'
                },
                boundary: {
                    type: 'object',
                    description: '裁剪矩形，字段 left / top / right / bottom（像素）'
                },
                maxSize: {
                    type: 'number',
                    description: '输出最大边长（像素），默认 2048'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG 质量提示，默认 85'
                },
                includeAlpha: {
                    type: 'boolean',
                    description: '是否附带 alpha 通道数据，默认 true'
                }
            }
        }
    };

    async execute(params: GetOptimizedImageParams): Promise<OptimizedImageResult> {
        const startTime = Date.now();
        const {
            documentId,
            layerId,
            boundary,
            maxSize = 2048,
            quality = 85,
            includeAlpha = true
        } = params;

        try {
            const doc = documentId
                ? app.documents.find((d: any) => d.id === documentId)
                : app.activeDocument;

            if (!doc) {
                return { success: false, error: '未找到文档，请先打开或指定 documentId' };
            }

            let targetLayer: any = null;
            if (layerId) {
                targetLayer = findLayerById(doc, layerId);
                if (!targetLayer) {
                    return { success: false, error: `未找到图层，ID: ${layerId}` };
                }
            } else if (doc.activeLayers?.length > 0) {
                targetLayer = doc.activeLayers[0];
            }

            const documentBounds: ImageBounds = {
                left: 0,
                top: 0,
                right: toNumber(doc.width),
                bottom: toNumber(doc.height),
                width: toNumber(doc.width),
                height: toNumber(doc.height)
            };

            const requestedBounds = boundary
                ? toBounds(boundary)
                : targetLayer
                    ? getLayerPixelBounds(targetLayer)
                    : { ...documentBounds };

            let targetWidth = requestedBounds.width;
            let targetHeight = requestedBounds.height;
            if (maxSize && (targetWidth > maxSize || targetHeight > maxSize)) {
                const scale = Math.min(maxSize / targetWidth, maxSize / targetHeight);
                targetWidth = Math.max(1, Math.round(targetWidth * scale));
                targetHeight = Math.max(1, Math.round(targetHeight * scale));
            }

            let colorData: string | null = null;
            let colorEncoding: 'jpeg' | 'raw_rgb' | null = null;
            let alphaData: string | null = null;
            let actualBounds: ImageBounds = requestedBounds;

            await core.executeAsModal(async () => {
                const getPixelsOptions: {
                    documentID: number;
                    layerID?: number;
                    sourceBounds: { left: number; top: number; right: number; bottom: number };
                    targetSize: { width: number; height: number };
                } = {
                    documentID: doc.id,
                    sourceBounds: {
                        left: requestedBounds.left,
                        top: requestedBounds.top,
                        right: requestedBounds.right,
                        bottom: requestedBounds.bottom
                    },
                    targetSize: { width: targetWidth, height: targetHeight },
                    ...(targetLayer?.id ? { layerID: targetLayer.id } : {})
                };

                const pixelResult = await imaging.getPixels(getPixelsOptions);
                if (!pixelResult?.imageData) {
                    throw new Error('无法读取像素数据');
                }

                actualBounds = normalizeReturnedBounds(pixelResult.sourceBounds, requestedBounds);
                const imageData = pixelResult.imageData;
                const actualWidth = imageData.width;
                const actualHeight = imageData.height;
                const components = imageData.components;

                try {
                    const jpegBase64 = await imaging.encodeImageData({ imageData, base64: true });
                    if (jpegBase64 && typeof jpegBase64 === 'string') {
                        colorData = `data:image/jpeg;base64,${jpegBase64}`;
                        colorEncoding = 'jpeg';
                        console.log(`[OptimizedTransfer] JPEG encoded: ${(jpegBase64.length / 1024).toFixed(0)}KB (quality hint ${quality})`);
                    }
                } catch (encodeError: any) {
                    console.log('[OptimizedTransfer] JPEG encoding failed:', encodeError.message);
                }

                if (includeAlpha && components >= 4) {
                    const rawData = await imageData.getData();
                    const pixelCount = actualWidth * actualHeight;
                    const alphaBytes = new Uint8Array(pixelCount);
                    for (let i = 0; i < pixelCount; i++) {
                        alphaBytes[i] = rawData[i * 4 + 3];
                    }
                    alphaData = `RAW_MASK:${actualWidth}:${actualHeight}:${encodeBytesToBase64(alphaBytes)}`;
                }

                if (!colorData) {
                    const rawData = await imageData.getData();
                    const pixelCount = actualWidth * actualHeight;
                    const rgbBytes = new Uint8Array(pixelCount * 3);
                    for (let i = 0; i < pixelCount; i++) {
                        rgbBytes[i * 3] = rawData[i * components];
                        rgbBytes[i * 3 + 1] = rawData[i * components + 1];
                        rgbBytes[i * 3 + 2] = rawData[i * components + 2];
                    }
                    colorData = `RAW_RGB:${actualWidth}:${actualHeight}:${encodeBytesToBase64(rgbBytes)}`;
                    colorEncoding = 'raw_rgb';
                }

                imageData.dispose();
            }, { commandName: 'DesignEcho: 优化图像导出' });

            return {
                success: true,
                colorData,
                colorEncoding,
                jpegData: colorEncoding === 'jpeg' ? colorData : null,
                alphaData,
                width: targetWidth,
                height: targetHeight,
                requestedBounds,
                actualBounds,
                documentBounds,
                source: targetLayer ? 'layer' : 'document',
                processingTime: Date.now() - startTime
            };
        } catch (error: any) {
            console.error('[OptimizedTransfer] Error:', error);
            return {
                success: false,
                error: error.message || String(error),
                processingTime: Date.now() - startTime
            };
        }
    }
}

export class OptimizedMattingImageTool implements Tool {
    name = 'getMattingImage';

    schema: ToolSchema = {
        name: 'getMattingImage',
        description: '导出单图层图像用于抠图等流程，可限制最大边长并选择 JPEG 或原始像素。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层 ID；省略则使用当前选中图层'
                },
                maxSize: {
                    type: 'number',
                    description: '输出最大边长（像素），默认 1024'
                },
                outputFormat: {
                    type: 'string',
                    enum: ['jpeg', 'raw'],
                    description: '输出格式：jpeg 或 raw'
                }
            }
        }
    };

    async execute(params: {
        layerId?: number;
        maxSize?: number;
        outputFormat?: 'jpeg' | 'raw';
    }): Promise<{
        success: boolean;
        imageData?: string;
        encoding?: 'jpeg' | 'raw';
        width?: number;
        height?: number;
        layerId?: number;
        requestedBounds?: ImageBounds;
        actualBounds?: ImageBounds;
        docWidth?: number;
        docHeight?: number;
        error?: string;
    }> {
        const {
            layerId,
            maxSize = 1024,
            outputFormat = 'jpeg'
        } = params;

        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '请先打开 Photoshop 文档' };
            }

            const targetLayer = layerId
                ? findLayerById(doc, layerId)
                : doc.activeLayers?.[0];

            if (!targetLayer) {
                return { success: false, error: '未找到目标图层' };
            }

            const requestedBounds = getLayerPixelBounds(targetLayer);
            let targetWidth = requestedBounds.width;
            let targetHeight = requestedBounds.height;
            if (maxSize && (targetWidth > maxSize || targetHeight > maxSize)) {
                const scale = Math.min(maxSize / targetWidth, maxSize / targetHeight);
                targetWidth = Math.max(1, Math.round(targetWidth * scale));
                targetHeight = Math.max(1, Math.round(targetHeight * scale));
            }

            let imageData: string | null = null;
            let actualBounds: ImageBounds = requestedBounds;

            await core.executeAsModal(async () => {
                const pixelResult = await imaging.getPixels({
                    documentID: doc.id,
                    layerID: targetLayer.id,
                    sourceBounds: {
                        left: requestedBounds.left,
                        top: requestedBounds.top,
                        right: requestedBounds.right,
                        bottom: requestedBounds.bottom
                    },
                    targetSize: { width: targetWidth, height: targetHeight }
                });

                if (!pixelResult?.imageData) {
                    throw new Error('无法读取像素数据');
                }

                actualBounds = normalizeReturnedBounds(pixelResult.sourceBounds, requestedBounds);
                const image = pixelResult.imageData;
                targetWidth = image.width;
                targetHeight = image.height;

                if (outputFormat === 'jpeg') {
                    const jpegBase64 = await imaging.encodeImageData({ imageData: image, base64: true });
                    if (!jpegBase64 || typeof jpegBase64 !== 'string') {
                        throw new Error('JPEG 编码失败');
                    }
                    imageData = `data:image/jpeg;base64,${jpegBase64}`;
                } else {
                    const rawData = await image.getData();
                    const components = image.components;
                    const byteLength = targetWidth * targetHeight * components;
                    const bytes = new Uint8Array(byteLength);
                    for (let i = 0; i < byteLength; i++) {
                        bytes[i] = rawData[i];
                    }
                    imageData = `RAW:${targetWidth}:${targetHeight}:${components}:${encodeBytesToBase64(bytes)}`;
                }

                image.dispose();
            }, { commandName: 'DesignEcho: 抠图图像导出' });

            return {
                success: true,
                imageData: imageData || undefined,
                encoding: outputFormat,
                width: targetWidth,
                height: targetHeight,
                layerId: targetLayer.id,
                requestedBounds,
                actualBounds,
                docWidth: toNumber(doc.width),
                docHeight: toNumber(doc.height)
            };
        } catch (error: any) {
            console.error('[MattingImage] Error:', error);
            return {
                success: false,
                error: error.message || String(error)
            };
        }
    }
}
