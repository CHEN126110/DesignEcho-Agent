/**
 * Inpainting UXP handlers.
 */

import type { UXPContext } from './types';
import sharp from 'sharp';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BinaryMessageType, getBinaryTypeName } from '../../shared/binary-protocol';

const INPAINTING_TEMP_DIR = path.join(os.tmpdir(), 'designecho-agent', 'inpainting');
const INPAINTING_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function ensureInpaintingTempDir(): Promise<string> {
    await fs.mkdir(INPAINTING_TEMP_DIR, { recursive: true });
    return INPAINTING_TEMP_DIR;
}

async function pruneInpaintingTempDir(): Promise<void> {
    try {
        const tempDir = await ensureInpaintingTempDir();
        const entries = await fs.readdir(tempDir, { withFileTypes: true });
        const now = Date.now();
        await Promise.all(entries.map(async (entry) => {
            if (!entry.isFile()) return;
            const fullPath = path.join(tempDir, entry.name);
            try {
                const stat = await fs.stat(fullPath);
                if (now - stat.mtimeMs > INPAINTING_TEMP_MAX_AGE_MS) {
                    await fs.unlink(fullPath);
                }
            } catch {
                // Ignore stale temp cleanup failures.
            }
        }));
    } catch {
        // Ignore temp cleanup failures so generation can continue.
    }
}

async function persistInpaintingImageToTempFile(imageBuffer: Buffer, extension: string = 'png'): Promise<string> {
    const tempDir = await ensureInpaintingTempDir();
    await pruneInpaintingTempDir();
    const safeExt = extension.replace(/^\./, '') || 'png';
    const filename = `inpainting_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const fullPath = path.join(tempDir, filename);
    await fs.writeFile(fullPath, imageBuffer);
    return fullPath;
}

async function waitForBinarySource(
    store: UXPContext['binaryImageStore'],
    requestId: number,
    expectedType: BinaryMessageType,
    timeoutMs: number = 8000
): Promise<{ buffer: Buffer; width: number; height: number; type: number }> {
    const start = Date.now();
    const pollIntervalMs = 50;
    while (Date.now() - start < timeoutMs) {
        const cached = store.get(requestId);
        if (cached && cached.type === expectedType) {
            store.delete(requestId);
            return {
                buffer: cached.data,
                width: cached.width,
                height: cached.height,
                type: cached.type
            };
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(
        `Timed out waiting for binary source frame: requestId=${requestId}, expected=${getBinaryTypeName(expectedType)}, waited=${timeoutMs}ms`
    );
}
/**
 * Register inpainting handlers.
 */
export function registerInpaintingHandlers(context: UXPContext): void {
    const { wsServer, logService, inpaintingService, binaryImageStore } = context;

    const inpaintingGenerateHandler = async (params: {
        image?: string;
        mask?: string;
        prompt: string;
        model?: string;
        imageFormat?: 'raw' | 'png' | 'jpeg';
        imageChannels?: number;
        maskFormat?: 'raw' | 'png';
        maskChannels?: number;
        imageWidth: number;
        imageHeight: number;
        selectionBounds?: {
            left?: number;
            top?: number;
            right?: number;
            bottom?: number;
        } | null;
        documentMeta?: {
            width?: number;
            height?: number;
            scale?: number;
            selectionBoundsOriginal?: {
                left?: number;
                top?: number;
                right?: number;
                bottom?: number;
            } | null;
        } | null;
        imageFromBinary?: boolean;
        imageBinaryRequestId?: number;
        imageBinaryWidth?: number;
        imageBinaryHeight?: number;
        maskFromBinary?: boolean;
        maskBinaryRequestId?: number;
        maskBinaryWidth?: number;
        maskBinaryHeight?: number;
    }) => {
        logService?.logAgent(
            'info',
            `[Inpainting] Start request, model=${params.model || 'flux-fill'}, imageFromBinary=${params.imageFromBinary === true}, maskFromBinary=${params.maskFromBinary === true}`
        );

        const sendProgress = (progress: number, message: string, stage?: string) => {
            wsServer.sendProgress('inpaint', progress, message, stage);
            logService?.logAgent('info', `[Inpainting] ${progress}% - ${message}${stage ? ` (${stage})` : ''}`);
        };

        try {
            if (!inpaintingService) {
                throw new Error('Inpainting service is not initialized');
            }

            let resolvedImage = typeof params.image === 'string' ? params.image : '';
            let resolvedMask = typeof params.mask === 'string' ? params.mask : '';
            let resolvedImageFormat = params.imageFormat;
            let resolvedMaskFormat = params.maskFormat;
            let resolvedImageChannels = params.imageChannels;
            let resolvedMaskChannels = params.maskChannels;
            let resolvedWidth = Number(params.imageWidth) || 0;
            let resolvedHeight = Number(params.imageHeight) || 0;

            logService?.logAgent(
                'info',
                `[Inpainting] Incoming payload summary: imageLen=${resolvedImage.length}, maskLen=${resolvedMask.length}, width=${resolvedWidth}, height=${resolvedHeight}, imageFormat=${resolvedImageFormat}, maskFormat=${resolvedMaskFormat}`
            );

            if (params.imageFromBinary === true) {
                const requestId = Number(params.imageBinaryRequestId);
                if (!Number.isFinite(requestId) || requestId <= 0) {
                    throw new Error('imageFromBinary=true but imageBinaryRequestId is missing/invalid');
                }
                if (!binaryImageStore) {
                    throw new Error('binaryImageStore is unavailable on UXPContext');
                }
                sendProgress(8, '正在接收原始图像', 'receive-image-binary');
                let binaryEntry;
                try {
                    binaryEntry = await waitForBinarySource(binaryImageStore, requestId, BinaryMessageType.RAW_RGBA, 8000);
                } catch (waitError: any) {
                    const snapshot = Array.from(binaryImageStore.entries()).map(([id, v]) => ({
                        id,
                        type: getBinaryTypeName(v.type as BinaryMessageType),
                        bytes: v.data?.length
                    }));
                    logService?.logAgent('error', `[Inpainting] Image binary wait timeout. expected requestId=${requestId}, type=RAW_RGBA. store snapshot=${JSON.stringify(snapshot)}`);
                    throw new Error(`Raw RGBA binary frame did not arrive (requestId=${requestId}): ${waitError?.message || waitError}`);
                }
                const width = Number(params.imageBinaryWidth) > 0 ? Number(params.imageBinaryWidth) : binaryEntry.width;
                const height = Number(params.imageBinaryHeight) > 0 ? Number(params.imageBinaryHeight) : binaryEntry.height;
                const expectedImageBytes = width * height * 4;
                if (binaryEntry.buffer.length !== expectedImageBytes) {
                    throw new Error(`Raw image binary size mismatch: got ${binaryEntry.buffer.length}, expected ${expectedImageBytes} (${width}x${height}x4)`);
                }
                resolvedImage = binaryEntry.buffer.toString('base64');
                resolvedImageFormat = 'raw';
                resolvedImageChannels = 4;
                resolvedWidth = width;
                resolvedHeight = height;
                logService?.logAgent('info', `[Inpainting] Resolved RAW_RGBA binary: requestId=${requestId}, ${width}x${height}, bytes=${binaryEntry.buffer.length}`);
            }

            if (params.maskFromBinary === true) {
                const requestId = Number(params.maskBinaryRequestId);
                if (!Number.isFinite(requestId) || requestId <= 0) {
                    throw new Error('maskFromBinary=true but maskBinaryRequestId is missing/invalid');
                }
                if (!binaryImageStore) {
                    throw new Error('binaryImageStore is unavailable on UXPContext');
                }
                sendProgress(10, '正在接收选区蒙版', 'receive-mask-binary');
                let binaryEntry;
                try {
                    binaryEntry = await waitForBinarySource(binaryImageStore, requestId, BinaryMessageType.RAW_MASK, 8000);
                } catch (waitError: any) {
                    const snapshot = Array.from(binaryImageStore.entries()).map(([id, v]) => ({
                        id,
                        type: getBinaryTypeName(v.type as BinaryMessageType),
                        bytes: v.data?.length
                    }));
                    logService?.logAgent('error', `[Inpainting] Mask binary wait timeout. expected requestId=${requestId}, type=RAW_MASK. store snapshot=${JSON.stringify(snapshot)}`);
                    throw new Error(`Raw mask binary frame did not arrive (requestId=${requestId}): ${waitError?.message || waitError}`);
                }
                const width = Number(params.maskBinaryWidth) > 0 ? Number(params.maskBinaryWidth) : binaryEntry.width;
                const height = Number(params.maskBinaryHeight) > 0 ? Number(params.maskBinaryHeight) : binaryEntry.height;
                const expectedMaskBytes = width * height;
                if (binaryEntry.buffer.length !== expectedMaskBytes) {
                    throw new Error(`Raw mask binary size mismatch: got ${binaryEntry.buffer.length}, expected ${expectedMaskBytes} (${width}x${height}x1)`);
                }
                if ((resolvedWidth > 0 && resolvedWidth !== width) || (resolvedHeight > 0 && resolvedHeight !== height)) {
                    throw new Error(`Image/mask binary dimensions mismatch: image=${resolvedWidth}x${resolvedHeight}, mask=${width}x${height}`);
                }
                resolvedMask = binaryEntry.buffer.toString('base64');
                resolvedMaskFormat = 'raw';
                resolvedMaskChannels = 1;
                resolvedWidth = width;
                resolvedHeight = height;
                logService?.logAgent('info', `[Inpainting] Resolved RAW_MASK binary: requestId=${requestId}, ${width}x${height}, bytes=${binaryEntry.buffer.length}`);
            }

            const result = await inpaintingService.inpaint({
                image: resolvedImage,
                mask: resolvedMask,
                prompt: params.prompt,
                model: params.model as any,
                skipPreview: true,
                imageFormat: resolvedImageFormat,
                imageChannels: resolvedImageChannels,
                maskFormat: resolvedMaskFormat,
                maskChannels: resolvedMaskChannels,
                imageWidth: resolvedWidth,
                imageHeight: resolvedHeight,
                selectionBounds: params.selectionBounds,
                documentMeta: params.documentMeta
            }, (event) => {
                sendProgress(event.progress, event.message, event.stage);
            });

            if (!result.success) {
                return {
                    success: false,
                    error: result.error || 'Inpainting failed',
                    errorStage: result.errorStage || '',
                    errorCode: result.errorCode || '',
                    errorDetail: result.errorDetail || ''
                };
            }

            sendProgress(99, 'Transferring result', 'transfer-result');
            logService?.logAgent(
                'info',
                `[Inpainting] Result summary: images=${result.images?.length || 0}, rawImages=${result.rawImages?.length || 0}, provider=${result.provider}, model=${result.model}`
            );
            logService?.logAgent('info', `[Inpainting] Success in ${result.processingTime}ms`);

            const images = Array.isArray(result.images) ? [...result.images] : [];
            const rawImages = Array.isArray(result.rawImages) ? result.rawImages : [];
            const meta = result.meta || null;
            let imageFilePath = '';
            if (result.imageBuffer instanceof Buffer && result.imageBuffer.length > 0) {
                const previewBuffer = await sharp(result.imageBuffer)
                    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
                    .png()
                    .toBuffer();
                const previewBase64 = previewBuffer.toString('base64');
                if (previewBase64) {
                    images.length = 0;
                    images.push(previewBase64);
                }
                imageFilePath = await persistInpaintingImageToTempFile(result.imageBuffer, 'png');
            }
            return {
                success: true,
                images,
                rawImages,
                imageFilePath,
                binaryResult: null,
                meta,
                processingTime: result.processingTime,
                provider: result.provider,
                model: result.model
            };
        } catch (error: any) {
            logService?.logAgent('error', `[Inpainting] Failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
                errorStage: typeof error?.errorStage === 'string' ? error.errorStage : '',
                errorCode: typeof error?.errorCode === 'string' ? error.errorCode : '',
                errorDetail: typeof error?.errorDetail === 'string' ? error.errorDetail : ''
            };
        }
    };

    wsServer.registerHandler('inpainting.generate', inpaintingGenerateHandler);
}
