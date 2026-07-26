import type { UXPContext } from './types';
import sharp from 'sharp';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { volcengineSeedreamService, SeedreamInputError } from '../services/volcengine-seedream-service';
import { volcengineJimengImageService } from '../services/volcengine-jimeng-image-service';
import { gptsapiGeminiImageService } from '../services/gptsapi-gemini-image-service';
import { BinaryMessageType, getBinaryTypeName } from '../../shared/binary-protocol';
import { normalizeImageGenerationResultFormat } from '../../shared/image-generation-result-format';

/**
 * 等待二进制 raw RGBA 帧到达（处理 ws 帧到达顺序晚于 JSON 请求的情况）
 */
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
 * 把 UXP 直传的 raw RGBA 字节包装成 PNG dataURL
 *   - 用 sharp.raw({ width, height, channels: 4 }) → png({ compressionLevel: 6 })
 *   - 不做缩放、不做质量损失，由下游 fitToUploadLimit 做大小自适应
 */
async function rawRgbaToPngDataUrl(rawBuffer: Buffer, width: number, height: number): Promise<string> {
    if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
        throw new Error('Raw RGBA buffer is empty');
    }
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new Error(`Invalid raw RGBA dimensions: ${width}x${height}`);
    }
    const expectedSize = width * height * 4;
    if (rawBuffer.length !== expectedSize) {
        throw new Error(`Raw RGBA buffer size mismatch: got ${rawBuffer.length}, expected ${expectedSize} (${width}x${height}x4)`);
    }
    const pngBuffer = await sharp(rawBuffer, {
        raw: { width, height, channels: 4 }
    })
        .png({ compressionLevel: 6, adaptiveFiltering: true })
        .toBuffer();
    return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

const IMAGE_TO_IMAGE_TEMP_DIR = path.join(os.tmpdir(), 'designecho-agent', 'image-to-image');
const IMAGE_TO_IMAGE_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function ensureImageToImageTempDir(): Promise<string> {
    await fs.mkdir(IMAGE_TO_IMAGE_TEMP_DIR, { recursive: true });
    return IMAGE_TO_IMAGE_TEMP_DIR;
}

async function pruneImageToImageTempDir(): Promise<void> {
    try {
        const tempDir = await ensureImageToImageTempDir();
        const entries = await fs.readdir(tempDir, { withFileTypes: true });
        const now = Date.now();
        await Promise.all(entries.map(async (entry) => {
            if (!entry.isFile()) return;
            const fullPath = path.join(tempDir, entry.name);
            try {
                const stat = await fs.stat(fullPath);
                if (now - stat.mtimeMs > IMAGE_TO_IMAGE_TEMP_MAX_AGE_MS) {
                    await fs.unlink(fullPath);
                }
            } catch {
                // Ignore cleanup failures for stale temp files.
            }
        }));
    } catch {
        // Ignore temp directory cleanup failures so generation can continue.
    }
}

async function persistImageToTempFile(imageBuffer: Buffer, extension: string = 'png'): Promise<string> {
    const tempDir = await ensureImageToImageTempDir();
    await pruneImageToImageTempDir();
    const safeExt = extension.replace(/^\./, '') || 'png';
    const filename = `image-to-image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const fullPath = path.join(tempDir, filename);
    await fs.writeFile(fullPath, imageBuffer);
    return fullPath;
}

function parseImageToImageError(error: any): {
    message: string;
    stage: string;
    code?: string;
    detail?: string;
} {
    if (error instanceof SeedreamInputError) {
        const role = error.role || 'source';
        return {
            message: error.message,
            stage: role === 'source' ? 'validate-source-image' : 'validate-reference-image',
            code: 'SeedreamInputError',
            detail: `本地校验未通过（${role}），请确认：1）图像已用无损 PNG/JPEG 编码；2）单边 ≥15px、总像素 ≤6000×6000；3）宽高比在 [1/16, 16]；4）文件 ≤10MB`
        };
    }

    const rawMessage = String(error?.message || error || 'Unknown image-to-image error');
    const codeMatch = rawMessage.match(/code=([^)]+)/i);
    const code = codeMatch?.[1]?.trim();
    const providerMessageMatch = rawMessage.match(/(?:Seedream|GPTsAPI) request failed:\s*(.+?)(?:\s*\(code=.*\))?$/i);
    const providerMessage = providerMessageMatch?.[1]?.trim();

    if (/参考图数量超限|reference image count exceeds/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-reference-image',
            code: 'ReferenceLimitExceeded',
            detail: '参考图数量超过当前模型支持上限'
        };
    }

    if (/invalid base64 image_url/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-source-image',
            code: 'InvalidParameter',
            detail: '上游识别到非法 base64 图像（本地应已拦截，出现该错误请检查 UXP 抓图链路）'
        };
    }

    if (/gpts api key is not configured/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-auth',
            code,
            detail: 'GPTs API Key is missing'
        };
    }

    if (/api key is not configured/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-auth',
            code,
            detail: 'Seedream API Key is missing'
        };
    }

    if (/即梦ai access key id \/ secret access key 未配置|jimeng.*access key/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-auth',
            code: code || 'JimengAuthMissing',
            detail: '即梦图生图缺少 Access Key ID / Secret Access Key'
        };
    }

    if (/即梦图生图缺少 tos 配置|tos 上传配置不完整/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-upload',
            code: code || 'JimengTosConfigMissing',
            detail: '即梦 4.6 图生图需要先配置 TOS 桶、Endpoint、Region 与公网访问地址'
        };
    }

    if (/prompt is required/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-prompt',
            code,
            detail: 'Prompt is required'
        };
    }

    if (/raw rgba binary frame did not arrive/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'capture-source-layer',
            code: code || 'BinaryFrameMissing',
            detail: '原始像素二进制帧未到达 Agent（可能 Agent 未重启加载新代码，或 WebSocket 大帧被中间件丢弃）。请确认 Agent 已重启，然后重试。'
        };
    }

    if (/failed to encode raw rgba to png/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'capture-source-layer',
            code: code || 'RawRgbaEncodeFailed',
            detail: '把原始像素编码为 PNG 时失败，通常是尺寸/通道数异常。建议换一个普通像素图层重试。'
        };
    }

    if (/binaryimagestore is unavailable|sourceFromBinary=true but sourceBinaryRequestId is missing/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'capture-source-layer',
            code: code || 'BinarySourceConfig',
            detail: 'v3 raw RGBA 通路未正确初始化。请确认 Agent 已彻底重启（不只是重载 UXP）。'
        };
    }

    if (/source image is required/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-source-image',
            code,
            detail: 'Source image is required'
        };
    }

    if (/does not support size preset|不支持分辨率档位/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'validate-size-preset',
            code: code || 'InvalidSizePreset',
            detail: '所选分辨率档位不受当前模型支持，请重新选择模型可用的档位'
        };
    }

    if (/parameter [`']?size[`']?.*(?:not valid|widthxheight|supported size preset)/i.test(rawMessage)) {
        return {
            message: '当前模型不支持所选输出分辨率',
            stage: 'validate-size-preset',
            code: code || 'InvalidSizePreset',
            detail: providerMessage || '请重新选择当前模型支持的分辨率档位后再试'
        };
    }

    if (/output_format.+not supported by the current model/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-request',
            code: code || 'InvalidParameter',
            detail: 'The selected Seedream model does not support the current output format parameter'
        };
    }

    if (/result failed/i.test(rawMessage)) {
        if (/\b401\b|\b403\b|unauthorized/i.test(rawMessage)) {
            return {
                message: rawMessage,
                stage: 'provider-auth',
                code,
                detail: 'GPTs API Key is invalid or unauthorized'
            };
        }

        return {
            message: rawMessage,
            stage: 'provider-result',
            code,
            detail: rawMessage
        };
    }

    if (/network timeout while connecting|dns lookup failed|network route is unreachable|connection refused by remote host|connection reset by remote host/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-timeout',
            code,
            detail: '无法连接 GPTs API 服务，请检查本机网络、DNS、代理或防火墙设置'
        };
    }

    if (/request failed/i.test(rawMessage)) {
        if (/\b401\b|\b403\b/.test(rawMessage)) {
            return {
                message: rawMessage,
                stage: 'provider-auth',
                code,
                detail: /gptsapi/i.test(rawMessage)
                    ? 'GPTs API Key is invalid or unauthorized'
                    : 'Ark API Key is invalid, unauthorized, or Seedream model access is not enabled'
            };
        }

        return {
            message: rawMessage,
            stage: 'provider-request',
            code,
            detail: providerMessage || 'Seedream provider request failed'
        };
    }

    if (/did not return any images|missing image data/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-result',
            code,
            detail: 'Seedream did not return a usable result image'
        };
    }

    if (/timeout|timed out|aborted/i.test(rawMessage)) {
        return {
            message: rawMessage,
            stage: 'provider-timeout',
            code,
            detail: 'The provider request timed out'
        };
    }

    return {
        message: rawMessage,
        stage: 'provider-unknown',
        code
    };
}

export function registerImageToImageHandlers(context: UXPContext): void {
    const { wsServer, logService, binaryImageStore } = context;

    const imageToImageGenerateHandler = async (params: {
        image?: string;
        prompt: string;
        model?: string;
        sizePreset?: string;
        referenceImages?: string[];
        originalWidth?: number;
        originalHeight?: number;
        placementWidth?: number;
        placementHeight?: number;
        targetBounds?: { left?: number; top?: number };
        sourceKind?: 'layer' | 'document';
        /** v3 零闪烁：UXP 已通过 binary ws frame 直传 raw RGBA，下面这两个字段定位它 */
        sourceFromBinary?: boolean;
        sourceBinaryRequestId?: number;
        sourceBinaryWidth?: number;
        sourceBinaryHeight?: number;
    }) => {
        const model = params.model || 'doubao-seedream-5-0-260128';
        const isGPTsAPIModel = model === 'gemini-3-pro-image-preview';
        const isJimengModel = model === 'jimeng-seedream-4-6';
        logService?.logAgent('info', `[ImageToImage] Start request, model=${model}, sizePreset=${params.sizePreset || 'default'}, sourceFromBinary=${params.sourceFromBinary === true}`);

        const sendProgress = (progress: number, message: string, stage?: string) => {
            wsServer.sendProgress('image-to-image', progress, message, stage);
            logService?.logAgent('info', `[ImageToImage] ${progress}% - ${message}${stage ? ` (${stage})` : ''}`);
        };

        try {
            // v3 零闪烁分支：从 binary ws 缓存里拉取 raw RGBA，sharp 编 PNG，注入 params.image
            let resolvedSourceImage = typeof params.image === 'string' ? params.image : '';
            logService?.logAgent('info', `[ImageToImage] Incoming payload summary: sourceFromBinary=${params.sourceFromBinary === true}, sourceBinaryRequestId=${params.sourceBinaryRequestId}, imageLen=${resolvedSourceImage.length}, refCount=${Array.isArray(params.referenceImages) ? params.referenceImages.length : 0}`);

            if (params.sourceFromBinary === true) {
                const requestId = Number(params.sourceBinaryRequestId);
                if (!Number.isFinite(requestId) || requestId <= 0) {
                    throw new Error('sourceFromBinary=true but sourceBinaryRequestId is missing/invalid');
                }
                if (!binaryImageStore) {
                    throw new Error('binaryImageStore is unavailable on UXPContext');
                }
                sendProgress(12, '正在解码原始像素', 'decode-source-binary');
                let binaryEntry;
                try {
                    binaryEntry = await waitForBinarySource(
                        binaryImageStore,
                        requestId,
                        BinaryMessageType.RAW_RGBA,
                        8000
                    );
                } catch (waitError: any) {
                    const snapshot = Array.from(binaryImageStore.entries()).map(([id, v]) => ({
                        id,
                        type: getBinaryTypeName(v.type),
                        bytes: v.data?.length
                    }));
                    logService?.logAgent('error', `[ImageToImage] Binary wait timeout. expected requestId=${requestId}, type=RAW_RGBA. store snapshot=${JSON.stringify(snapshot)}`);
                    throw new Error(`Raw RGBA binary frame did not arrive (requestId=${requestId}): ${waitError?.message || waitError}`);
                }
                const width = Number(params.sourceBinaryWidth) > 0
                    ? Number(params.sourceBinaryWidth)
                    : binaryEntry.width;
                const height = Number(params.sourceBinaryHeight) > 0
                    ? Number(params.sourceBinaryHeight)
                    : binaryEntry.height;
                logService?.logAgent('info', `[ImageToImage] Decoding raw RGBA: ${width}x${height}, ${(binaryEntry.buffer.length / 1024).toFixed(0)}KB`);
                sendProgress(15, '正在生成无损 PNG', 'encode-source-png');
                try {
                    resolvedSourceImage = await rawRgbaToPngDataUrl(binaryEntry.buffer, width, height);
                } catch (encodeError: any) {
                    throw new Error(`Failed to encode raw RGBA to PNG: ${encodeError?.message || encodeError}`);
                }
                logService?.logAgent('info', `[ImageToImage] Raw RGBA → PNG dataUrl ${(resolvedSourceImage.length / 1024).toFixed(0)}KB`);
            }

            if (!resolvedSourceImage) {
                throw new Error('Source image is required');
            }

            const result = isGPTsAPIModel
                ? await gptsapiGeminiImageService.generateFromImage(
                    params.prompt,
                    resolvedSourceImage,
                    {
                        model,
                        outputFormat: 'jpeg',
                        referenceImages: Array.isArray(params.referenceImages) ? params.referenceImages : []
                    },
                    (event) => sendProgress(event.progress, event.message, event.stage)
                )
                : isJimengModel
                    ? await volcengineJimengImageService.generateFromImage(
                        params.prompt,
                        resolvedSourceImage,
                        {
                            sizePreset: params.sizePreset,
                            referenceImages: Array.isArray(params.referenceImages) ? params.referenceImages : [],
                            forceSingle: true
                        },
                        (event) => sendProgress(event.progress, event.message, event.stage)
                    )
                : await volcengineSeedreamService.generateFromImage(
                    params.prompt,
                    resolvedSourceImage,
                    {
                        model: model as any,
                        sizePreset: params.sizePreset,
                        referenceImages: Array.isArray(params.referenceImages) ? params.referenceImages : []
                    },
                    (event) => sendProgress(event.progress, event.message, event.stage)
                );

            sendProgress(96, 'Preparing result file', 'prepare-result-file');
            const metadata = await sharp(result.image).metadata();
            const detectedOutputFormat = normalizeImageGenerationResultFormat(metadata.format);
            const outputFormat = detectedOutputFormat || 'png';
            const persistedImageBuffer = detectedOutputFormat
                ? result.image
                : await sharp(result.image).png().toBuffer();
            const previewBuffer = await sharp(persistedImageBuffer)
                .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
                .png()
                .toBuffer();
            const previewBase64 = previewBuffer.toString('base64');
            const imageFilePath = await persistImageToTempFile(persistedImageBuffer, outputFormat);
            logService?.logAgent(
                'info',
                `[ImageToImage] Result prepared: format=${outputFormat}, size=${metadata.width || 0}x${metadata.height || 0}, bytes=${persistedImageBuffer.length}`
            );

            return {
                success: true,
                images: previewBase64 ? [previewBase64] : [],
                imageFilePath,
                meta: {
                    provider: isGPTsAPIModel ? 'gptsapi' : (isJimengModel ? 'jimeng' : 'seedream'),
                    model: result.model,
                    outputFormat,
                    sizePreset: 'sizePreset' in result ? result.sizePreset : (params.sizePreset || '2K'),
                    sourceKind: params.sourceKind || 'document',
                    originalWidth: params.originalWidth || 0,
                    originalHeight: params.originalHeight || 0,
                    outputWidth: metadata.width || params.originalWidth || 0,
                    outputHeight: metadata.height || params.originalHeight || 0,
                    referenceImageCount: Array.isArray(params.referenceImages) ? params.referenceImages.length : 0,
                    placementWidth: params.placementWidth || params.originalWidth || 0,
                    placementHeight: params.placementHeight || params.originalHeight || 0,
                    targetBounds: params.targetBounds || { left: 0, top: 0 }
                }
            };
        } catch (error: any) {
            const parsedError = parseImageToImageError(error);
            logService?.logAgent('error', `[ImageToImage] Failed: ${error?.message || String(error)}`);
            return {
                success: false,
                error: parsedError.message,
                errorStage: parsedError.stage,
                errorCode: parsedError.code,
                errorDetail: parsedError.detail
            };
        }
    };

    wsServer.registerHandler('imageToImage.generate', imageToImageGenerateHandler);
}
