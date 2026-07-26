import axios from 'axios';
import { getAxiosProxyConfig } from './network-proxy';
import sharp from 'sharp';

export type SeedreamModel =
    | 'doubao-seedream-5-0-pro-260628'
    | 'doubao-seedream-5-0-260128'
    | 'doubao-seedream-5-0-lite-260128'
    | 'doubao-seedream-4-5-251128'
    | 'doubao-seedream-4-0-250828';

export type SeedreamSizePreset = '1K' | '2K' | '3K' | '4K';

// 火山方舟 Seedream 图生图输入限制（基于 2026 官方文档 + DMX 镜像）
const SEEDREAM_INPUT_LIMITS = {
    // 上游硬限 10 MiB；本地预留 0.5 MiB 余量给 multipart/form-data 包头与 JSON 字段
    maxFileBytes: 10 * 1024 * 1024,
    softFileBytes: Math.floor(9.5 * 1024 * 1024),
    maxTotalPixels: 6000 * 6000,
    minEdgePx: 15,
    minAspectRatio: 1 / 16,
    maxAspectRatio: 16
} as const;

// Seedream 5.0 本身参考图限制偏保守（10 张），5.0 lite / 4.5 / 4.0 放宽到 14 张
const SEEDREAM_REFERENCE_LIMIT: Record<SeedreamModel, number> = {
    'doubao-seedream-5-0-pro-260628': 10,
    'doubao-seedream-5-0-260128': 10,
    'doubao-seedream-5-0-lite-260128': 14,
    'doubao-seedream-4-5-251128': 14,
    'doubao-seedream-4-0-250828': 14
};

// 入图 mime 白名单：jpeg/png 全部接受；webp/bmp/tiff/gif 仅 5.0-lite/4.5/4.0
const SEEDREAM_BASE_MIME_WHITELIST: ReadonlyArray<string> = ['image/jpeg', 'image/jpg', 'image/png'];
const SEEDREAM_EXTRA_MIME_WHITELIST: ReadonlyArray<string> = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif'
];

function getAllowedMimeForModel(model: SeedreamModel): ReadonlyArray<string> {
    return model === 'doubao-seedream-5-0-260128' || model === 'doubao-seedream-5-0-pro-260628'
        ? SEEDREAM_BASE_MIME_WHITELIST
        : SEEDREAM_EXTRA_MIME_WHITELIST;
}

const BASE64_CHAR_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/i;

export interface SeedreamGenerateProgressEvent {
    progress: number;
    stage:
        | 'provider-validate'
        | 'provider-submit'
        | 'provider-waiting'
        | 'provider-ready'
        | 'provider-download';
    message: string;
}

export type SeedreamGenerateProgressCallback = (event: SeedreamGenerateProgressEvent) => void;

type SeedreamResponseFormat = 'b64_json' | 'url';

export interface SeedreamGenerateResult {
    image: Buffer;
    model: SeedreamModel;
    sizePreset: SeedreamSizePreset;
    requestId?: string;
}

type SeedreamGenerationResponse = {
    created?: number;
    request_id?: string;
    data?: Array<{
        b64_json?: string;
        url?: string;
    }>;
    error?: {
        message?: string;
        type?: string;
        code?: string | number;
    };
};

const SEEDREAM_API_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL: SeedreamModel = 'doubao-seedream-5-0-260128';

const SEEDREAM_MODEL_CAPABILITIES: Record<
    SeedreamModel,
    {
        defaultSize: SeedreamSizePreset;
        supportedSizes: SeedreamSizePreset[];
        supportsOutputFormat: boolean;
    }
> = {
    // Pro（260628）：方舟仅接受 1K / 2K 分辨率档位；4K 不是该模型的合法预设。
    'doubao-seedream-5-0-pro-260628': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K'],
        supportsOutputFormat: true
    },
    'doubao-seedream-5-0-260128': {
        defaultSize: '2K',
        supportedSizes: ['2K', '3K'],
        supportsOutputFormat: true
    },
    'doubao-seedream-5-0-lite-260128': {
        defaultSize: '2K',
        supportedSizes: ['2K', '3K', '4K'],
        supportsOutputFormat: true
    },
    'doubao-seedream-4-5-251128': {
        defaultSize: '2K',
        supportedSizes: ['2K', '4K'],
        supportsOutputFormat: false
    },
    'doubao-seedream-4-0-250828': {
        defaultSize: '2K',
        supportedSizes: ['1K', '2K', '4K'],
        supportsOutputFormat: false
    }
};

export class VolcengineSeedreamService {
    private apiKey = '';

    setApiKey(apiKey?: string): void {
        this.apiKey = String(apiKey || '').trim();
    }

    hasApiKey(): boolean {
        return this.apiKey.length > 0;
    }

    async testApiKey(apiKey?: string): Promise<{ success: boolean; message?: string; error?: string; status?: number }> {
        const keyToTest = String(apiKey ?? this.apiKey ?? '').trim();
        if (!keyToTest) {
            return { success: false, error: '请先输入 Ark API Key' };
        }

        try {
            const response = await axios.post<SeedreamGenerationResponse>(
                `${SEEDREAM_API_BASE_URL}/images/generations`,
                {
                    model: DEFAULT_MODEL,
                    prompt: 'connectivity test',
                    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0eQAAAAASUVORK5CYII=',
                    response_format: 'url',
                    output_format: 'png',
                    size: 'TEST',
                    watermark: false
                },
                {
                    timeout: 20_000,
                    validateStatus: () => true,
                    ...getAxiosProxyConfig(),
                    headers: {
                        Authorization: `Bearer ${keyToTest}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    status: response.status,
                    error: '当前 Ark API Key 无效、无权限，或对应账号未开通 Seedream 模型权限。当前服务地域：华北 2（北京）。'
                };
            }

            if (response.status >= 200 && response.status < 300) {
                return { success: true, status: response.status, message: '连接成功，Ark API Key 可用。' };
            }

            if (response.status === 400 || response.status === 422) {
                return {
                    success: true,
                    status: response.status,
                    message: '连通性正常，Ark 鉴权已通过。'
                };
            }

            const providerMessage = String(response.data?.error?.message || '').trim();
            return {
                success: false,
                status: response.status,
                error: providerMessage || `Ark 连通性测试失败 (${response.status})`
            };
        } catch (error: any) {
            return { success: false, error: error?.message || '网络连接失败' };
        }
    }

    async generateFromImage(
        prompt: string,
        imageDataUrl: string,
        options?: {
            model?: SeedreamModel;
            sizePreset?: SeedreamSizePreset | string;
            referenceImages?: string[];
            timeoutMs?: number;
        },
        onProgress?: SeedreamGenerateProgressCallback
    ): Promise<SeedreamGenerateResult> {
        if (!this.hasApiKey()) {
            throw new Error('Volcengine Seedream API Key is not configured');
        }

        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) {
            throw new Error('Prompt is required');
        }

        const cleanImage = String(imageDataUrl || '').trim();
        if (!cleanImage) {
            throw new Error('Source image is required');
        }

        const model = this.normalizeModel(options?.model);
        const sizePreset = this.resolveSizePreset(model, options?.sizePreset);

        const referenceLimit = SEEDREAM_REFERENCE_LIMIT[model] ?? 10;
        const rawReferenceImages = Array.isArray(options?.referenceImages)
            ? options!.referenceImages
                .map((item) => String(item || '').trim())
                .filter(Boolean)
            : [];
        if (rawReferenceImages.length > referenceLimit) {
            throw new Error(
                `参考图数量超限：${model} 最多支持 ${referenceLimit} 张，当前传入 ${rawReferenceImages.length} 张`
            );
        }

        // 主图 + 参考图分别做严格校验（base64 合法性 / 解码 / 像素 / 宽高比 / 字节大小 / mime 白名单）
        const preparedSource = await this.prepareImageInput(cleanImage, model, 'source');
        const preparedReferences = await Promise.all(
            rawReferenceImages.map((item, idx) =>
                this.prepareImageInput(item, model, `reference-${idx + 1}`)
            )
        );

        const imagePayload = preparedReferences.length > 0
            ? [preparedSource.dataUrl, ...preparedReferences.map((ref) => ref.dataUrl)]
            : preparedSource.dataUrl;
        const responseFormat = this.resolveResponseFormat(sizePreset);
        const capabilities = SEEDREAM_MODEL_CAPABILITIES[model];
        const requestBody: Record<string, unknown> = {
            model,
            prompt: cleanPrompt,
            image: imagePayload,
            response_format: responseFormat,
            size: sizePreset,
            watermark: false
        };
        if (capabilities?.supportsOutputFormat) {
            requestBody.output_format = 'png';
        }

        onProgress?.({
            progress: 12,
            stage: 'provider-validate',
            message: 'Validating Seedream request'
        });

        onProgress?.({
            progress: 30,
            stage: 'provider-submit',
            message: 'Submitting image edit request to Seedream'
        });

        const response = await axios.post<SeedreamGenerationResponse>(
            `${SEEDREAM_API_BASE_URL}/images/generations`,
            requestBody,
            {
                timeout: Math.max(30_000, options?.timeoutMs || 5 * 60 * 1000),
                validateStatus: () => true,
                ...getAxiosProxyConfig(),
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const payload = response.data;
        if (response.status >= 400 || payload?.error) {
            const providerMessage =
                payload?.error?.message ||
                (typeof payload === 'string' ? payload : '') ||
                `HTTP ${response.status}`;
            const providerCode = payload?.error?.code;
            const code = providerCode ? ` (code=${providerCode})` : '';
            throw new Error(`Seedream request failed: ${providerMessage}${code}`);
        }

        onProgress?.({
            progress: 78,
            stage: 'provider-waiting',
            message: 'Seedream returned result metadata'
        });

        const firstItem = Array.isArray(payload?.data) ? payload.data[0] : null;
        if (!firstItem) {
            throw new Error('Seedream did not return any images');
        }

        if (firstItem.b64_json) {
            onProgress?.({
                progress: 92,
                stage: 'provider-ready',
                message: 'Decoding Seedream result'
            });
            return {
                image: Buffer.from(firstItem.b64_json, 'base64'),
                model,
                sizePreset,
                requestId: payload?.request_id
            };
        }

        if (firstItem.url) {
            onProgress?.({
                progress: 92,
                stage: 'provider-download',
                message: 'Downloading Seedream result'
            });
            const imageResponse = await axios.get<ArrayBuffer>(firstItem.url, {
                responseType: 'arraybuffer',
                timeout: 120_000,
                ...getAxiosProxyConfig()
            });
            return {
                image: Buffer.from(imageResponse.data),
                model,
                sizePreset,
                requestId: payload?.request_id
            };
        }

        throw new Error('Seedream result payload is missing image data');
    }

    private normalizeModel(model?: string): SeedreamModel {
        const normalized = String(model || '').trim() as SeedreamModel;
        return Object.prototype.hasOwnProperty.call(SEEDREAM_MODEL_CAPABILITIES, normalized)
            ? normalized
            : DEFAULT_MODEL;
    }

    private resolveSizePreset(model: SeedreamModel, requested?: string): SeedreamSizePreset {
        const capabilities = SEEDREAM_MODEL_CAPABILITIES[model];
        const normalized = String(requested || '').trim().toUpperCase() as SeedreamSizePreset;
        if (!normalized) {
            return capabilities.defaultSize;
        }
        if (capabilities.supportedSizes.includes(normalized)) {
            return normalized;
        }
        throw new Error(
            `当前模型 ${model} 不支持分辨率档位 ${requested}，支持：${capabilities.supportedSizes.join(' / ')}`
        );
    }

    private resolveResponseFormat(_sizePreset: SeedreamSizePreset): SeedreamResponseFormat {
        // Prefer URL results for every size so the provider response stays small and
        // the downstream Agent -> UXP path can work from a local temp file instead of
        // carrying large base64 payloads through JSON.
        return 'url';
    }

    /**
     * 对传入的图像进行完整校验并规范成合法 data URL。
     *
     * 校验项（按顺序失败抛错）：
     *  1. 字符串非空
     *  2. data URL 格式（或纯 base64）解析
     *  3. base64 字符集合法（A-Z a-z 0-9 + / =）
     *  4. base64 解码不报错
     *  5. 字节 ≤ 10MB
     *  6. sharp 能解析出宽高
     *  7. 单边 ≥ 15px，总像素 ≤ 36MP，宽高比 ∈ [1/16, 16]
     *  8. 最终 mime 属于当前模型允许列表（不在则按 sharp 元数据重新打 mime）
     */
    private async prepareImageInput(
        imageData: string,
        model: SeedreamModel,
        role: 'source' | `reference-${number}`
    ): Promise<{ dataUrl: string; mime: string; bytes: number; width: number; height: number }> {
        const trimmed = String(imageData || '').trim();
        if (!trimmed) {
            throw new SeedreamInputError(`${role} image is empty`, role);
        }

        let mime = 'image/png';
        let base64Raw = trimmed;
        const match = DATA_URL_REGEX.exec(trimmed);
        if (match) {
            mime = String(match[1] || '').trim().toLowerCase();
            base64Raw = String(match[2] || '').trim();
        }

        const base64Clean = base64Raw.replace(/\s+/g, '');
        if (!base64Clean) {
            throw new SeedreamInputError(`${role} image base64 is empty`, role);
        }
        if (!BASE64_CHAR_REGEX.test(base64Clean)) {
            const preview = base64Clean.slice(0, 48);
            throw new SeedreamInputError(
                `${role} image base64 contains illegal characters (preview="${preview}...")`,
                role
            );
        }
        if (base64Clean.length % 4 !== 0) {
            throw new SeedreamInputError(
                `${role} image base64 length (${base64Clean.length}) is not a multiple of 4`,
                role
            );
        }

        let buffer: Buffer;
        try {
            buffer = Buffer.from(base64Clean, 'base64');
        } catch (decodeError) {
            const message = decodeError instanceof Error ? decodeError.message : String(decodeError);
            throw new SeedreamInputError(`${role} image base64 decode failed: ${message}`, role);
        }

        if (buffer.length === 0) {
            throw new SeedreamInputError(`${role} image decoded to 0 bytes`, role);
        }

        let metadata: sharp.Metadata;
        try {
            metadata = await sharp(buffer).metadata();
        } catch (metaError) {
            const message = metaError instanceof Error ? metaError.message : String(metaError);
            throw new SeedreamInputError(`${role} image could not be decoded by sharp: ${message}`, role);
        }

        const width = Number(metadata.width) || 0;
        const height = Number(metadata.height) || 0;
        if (width <= 0 || height <= 0) {
            throw new SeedreamInputError(`${role} image has invalid dimensions (${width}x${height})`, role);
        }
        if (width < SEEDREAM_INPUT_LIMITS.minEdgePx || height < SEEDREAM_INPUT_LIMITS.minEdgePx) {
            throw new SeedreamInputError(
                `${role} image edge too small: ${width}x${height} (minimum ${SEEDREAM_INPUT_LIMITS.minEdgePx}px per side)`,
                role
            );
        }
        if (width * height > SEEDREAM_INPUT_LIMITS.maxTotalPixels) {
            throw new SeedreamInputError(
                `${role} image total pixels ${width * height} exceed 6000×6000 = ${SEEDREAM_INPUT_LIMITS.maxTotalPixels}`,
                role
            );
        }
        const aspect = width / height;
        if (aspect < SEEDREAM_INPUT_LIMITS.minAspectRatio || aspect > SEEDREAM_INPUT_LIMITS.maxAspectRatio) {
            throw new SeedreamInputError(
                `${role} image aspect ratio ${aspect.toFixed(3)} out of [1/16, 16]`,
                role
            );
        }

        const fitted = await this.fitToUploadLimit(buffer, mime, model, role);
        return {
            dataUrl: `data:${fitted.mime};base64,${fitted.base64}`,
            mime: fitted.mime,
            bytes: fitted.bytes,
            width,
            height
        };
    }

    /**
     * Volcengine 上传上限 10 MiB 是服务端硬性约束（不可调）。
     *
     * 适配规则（保持画质优先，无需用户感知）：
     *  1. 解码字节 ≤ 9.5 MiB → 直接以原 mime/原始 base64 发送（无损 PNG 优先）
     *  2. 否则按 mozjpeg q=92 重打（视觉无损，对 jpeg 白名单内的所有模型都合法）
     *  3. 还超就 q=82 重打（mozjpeg 在 q=82 仍接近视觉无损，几乎不会再失败）
     *  4. 都不行才抛 SeedreamInputError，由 UI 提示用户降低 size 档位或自行裁切
     *
     * 这里没有"原图替代品"概念——所有重打的产物都是合法、上传可用的；它本身就是
     * 最优路线，不属于 fallback。
     */
    private async fitToUploadLimit(
        rawBuffer: Buffer,
        rawMime: string,
        model: SeedreamModel,
        role: string
    ): Promise<{ base64: string; mime: string; bytes: number }> {
        const allowed = getAllowedMimeForModel(model);
        const allowsJpeg = allowed.includes('image/jpeg') || allowed.includes('image/jpg');
        const softLimit = SEEDREAM_INPUT_LIMITS.softFileBytes;
        const hardLimit = SEEDREAM_INPUT_LIMITS.maxFileBytes;

        if (rawBuffer.length <= softLimit) {
            const finalMime = this.resolveMimeForModel(model, rawMime, rawMime, role);
            return {
                base64: rawBuffer.toString('base64'),
                mime: finalMime,
                bytes: rawBuffer.length
            };
        }

        if (!allowsJpeg) {
            throw new SeedreamInputError(
                `${role} image is ${(rawBuffer.length / 1024 / 1024).toFixed(2)}MB and exceeds the 10MB upload limit; ` +
                `model ${model} does not accept JPEG so automatic recompression is unavailable`,
                role
            );
        }

        for (const quality of [92, 82]) {
            try {
                const repacked = await sharp(rawBuffer)
                    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
                    .toBuffer();
                if (repacked.length <= softLimit) {
                    return {
                        base64: repacked.toString('base64'),
                        mime: 'image/jpeg',
                        bytes: repacked.length
                    };
                }
            } catch (jpegError) {
                const message = jpegError instanceof Error ? jpegError.message : String(jpegError);
                throw new SeedreamInputError(
                    `${role} image JPEG repack failed at quality=${quality}: ${message}`,
                    role
                );
            }
        }

        const fallbackInfo = `${(rawBuffer.length / 1024 / 1024).toFixed(2)}MB original`;
        throw new SeedreamInputError(
            `${role} image still exceeds Volcengine ${(hardLimit / 1024 / 1024).toFixed(0)}MB upload limit ` +
            `after mozjpeg q=82 recompression (${fallbackInfo}); please switch the size preset to a lower tier ` +
            `(e.g. 2K) or simplify the layer content`,
            role
        );
    }

    private resolveMimeForModel(
        model: SeedreamModel,
        requested: string,
        detected: string,
        role: string
    ): string {
        const allow = getAllowedMimeForModel(model);
        const requestedNormalized = String(requested || '').trim().toLowerCase();
        const detectedNormalized = String(detected || '').trim().toLowerCase();

        if (allow.includes(requestedNormalized)) {
            return requestedNormalized;
        }
        if (allow.includes(detectedNormalized)) {
            return detectedNormalized;
        }
        throw new SeedreamInputError(
            `${role} image mime not allowed for ${model}: requested=${requestedNormalized || 'unknown'}, detected=${detectedNormalized || 'unknown'}, allowed=${allow.join('/')}`,
            role
        );
    }
}

export class SeedreamInputError extends Error {
    constructor(message: string, public readonly role: string) {
        super(message);
        this.name = 'SeedreamInputError';
    }
}

export const volcengineSeedreamService = new VolcengineSeedreamService();
