import axios from 'axios';
import sharp from 'sharp';
import { getAxiosProxyConfig } from './network-proxy';

export type OpenRouterGeminiImageModel = 'google/gemini-3-pro-image-preview';

export interface OpenRouterGeminiImageProgressEvent {
    progress: number;
    stage:
        | 'provider-validate'
        | 'provider-submit'
        | 'provider-ready'
        | 'provider-download';
    message: string;
}

export type OpenRouterGeminiImageProgressCallback = (event: OpenRouterGeminiImageProgressEvent) => void;

export interface OpenRouterGeminiImageResult {
    image: Buffer;
    model: OpenRouterGeminiImageModel;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    aspectRatio: string;
    imageSize: '1K' | '2K' | '4K';
}

type OpenRouterImageBlock = {
    image_url?: {
        url?: string;
    };
    imageUrl?: {
        url?: string;
    };
};

type OpenRouterChatCompletionResponse = {
    id?: string;
    choices?: Array<{
        message?: {
            images?: OpenRouterImageBlock[];
            content?: string | Array<{ type?: string; text?: string }>;
        };
    }>;
    error?: {
        message?: string;
        code?: string;
    };
};

type ServiceError = Error & {
    errorStage?: string;
    errorCode?: string;
    errorDetail?: string;
    provider?: 'openrouter';
};

const OPENROUTER_CHAT_COMPLETIONS_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL: OpenRouterGeminiImageModel = 'google/gemini-3-pro-image-preview';
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;
const SUPPORTED_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;

export class OpenRouterGeminiImageService {
    private apiKey = '';

    setApiKey(apiKey?: string): void {
        this.apiKey = String(apiKey || '').trim();
    }

    hasApiKey(): boolean {
        return this.apiKey.length > 0;
    }

    async editImage(
        prompt: string,
        sourceImage: Buffer,
        maskImage: Buffer,
        options?: {
            model?: OpenRouterGeminiImageModel | string;
            timeoutMs?: number;
        },
        onProgress?: OpenRouterGeminiImageProgressCallback
    ): Promise<OpenRouterGeminiImageResult> {
        if (!this.hasApiKey()) {
            throw this.createStageError('OpenRouter API Key 未配置', 'provider-validate');
        }

        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) {
            throw this.createStageError('Prompt is required', 'provider-validate');
        }
        if (!(sourceImage instanceof Buffer) || sourceImage.length === 0) {
            throw this.createStageError('Source image is required', 'provider-validate');
        }
        if (!(maskImage instanceof Buffer) || maskImage.length === 0) {
            throw this.createStageError('Mask image is required', 'provider-validate');
        }

        const model = this.normalizeModel(options?.model);
        const timeoutMs = Math.max(30_000, options?.timeoutMs || 180_000);

        onProgress?.({
            progress: 28,
            stage: 'provider-validate',
            message: 'Preparing OpenRouter inpainting request'
        });

        const sourceMetadata = await sharp(sourceImage).metadata();
        const width = Math.max(1, sourceMetadata.width || 1024);
        const height = Math.max(1, sourceMetadata.height || 1024);
        const aspectRatio = this.resolveAspectRatio(width, height);
        const imageSize = this.resolveImageSize(width, height);

        const normalizedMask = await this.normalizeMask(maskImage);
        const guideImage = await this.buildGuideImage(sourceImage, normalizedMask);

        const sourceDataUrl = await this.encodeImageDataUrl(sourceImage, 'source');
        const maskDataUrl = await this.encodeImageDataUrl(normalizedMask, 'mask');
        const guideDataUrl = await this.encodeImageDataUrl(guideImage, 'guide');

        const requestBody = {
            model,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: this.buildEditInstruction(cleanPrompt)
                        },
                        { type: 'image_url', imageUrl: { url: sourceDataUrl } },
                        { type: 'image_url', imageUrl: { url: maskDataUrl } },
                        { type: 'image_url', imageUrl: { url: guideDataUrl } }
                    ]
                }
            ],
            modalities: ['image', 'text'],
            image_config: {
                aspect_ratio: aspectRatio,
                image_size: imageSize
            },
            stream: false
        };

        onProgress?.({
            progress: 46,
            stage: 'provider-submit',
            message: 'Submitting image edit request to OpenRouter'
        });

        let response;
        try {
            response = await axios.post<OpenRouterChatCompletionResponse>(
                OPENROUTER_CHAT_COMPLETIONS_ENDPOINT,
                requestBody,
                {
                    timeout: timeoutMs,
                    ...getAxiosProxyConfig(),
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'https://designecho.app',
                        'X-Title': 'DesignEcho Agent'
                    }
                }
            );
        } catch (error: any) {
            throw this.wrapAxiosError(error);
        }

        const payload = response.data;
        const imageUrl = this.extractImageUrl(payload);
        if (!imageUrl) {
            const responseText = this.extractResponseText(payload);
            throw this.createStageError(
                responseText
                    ? `OpenRouter did not return an image result: ${responseText}`
                    : 'OpenRouter did not return an image result',
                'provider-ready'
            );
        }

        onProgress?.({
            progress: 82,
            stage: 'provider-ready',
            message: 'OpenRouter returned image result'
        });

        const resolved = await this.resolveImageUrl(imageUrl);

        onProgress?.({
            progress: 92,
            stage: 'provider-download',
            message: 'Downloading OpenRouter image result'
        });

        return {
            image: resolved.image,
            model,
            mimeType: resolved.mimeType,
            aspectRatio,
            imageSize
        };
    }

    private normalizeModel(model?: string): OpenRouterGeminiImageModel {
        return String(model || '').trim() === DEFAULT_MODEL ? DEFAULT_MODEL : DEFAULT_MODEL;
    }

    private buildEditInstruction(prompt: string): string {
        return [
            'You are editing a Photoshop inpainting crop.',
            'Image 1 is the original crop.',
            'Image 2 is a binary mask where white pixels are editable and black pixels must stay unchanged.',
            'Image 3 is a guide overlay that highlights the editable region.',
            `Task: ${prompt}`,
            'Rules:',
            '- Edit only the masked region.',
            '- Preserve unmasked content, layout, perspective, lighting, shadows, texture, lens characteristics, and color continuity.',
            '- Keep the result aligned with the original crop so it can be composited back into Photoshop.',
            '- Return one edited image.'
        ].join('\n');
    }

    private async normalizeMask(maskImage: Buffer): Promise<Buffer> {
        return sharp(maskImage)
            .grayscale()
            .threshold(8)
            .png()
            .toBuffer();
    }

    private async buildGuideImage(sourceImage: Buffer, normalizedMask: Buffer): Promise<Buffer> {
        const source = sharp(sourceImage).ensureAlpha();
        const sourceMetadata = await source.metadata();
        const width = Math.max(1, sourceMetadata.width || 1);
        const height = Math.max(1, sourceMetadata.height || 1);

        const maskRaw = await sharp(normalizedMask)
            .resize(width, height, { fit: 'fill' })
            .ensureAlpha()
            .extractChannel('red')
            .raw()
            .toBuffer();

        const overlayRaw = Buffer.alloc(width * height * 4);
        for (let i = 0; i < width * height; i += 1) {
            const alpha = maskRaw[i] > 0 ? 132 : 0;
            const offset = i * 4;
            overlayRaw[offset] = 255;
            overlayRaw[offset + 1] = 84;
            overlayRaw[offset + 2] = 84;
            overlayRaw[offset + 3] = alpha;
        }

        return source
            .composite([
                {
                    input: overlayRaw,
                    raw: { width, height, channels: 4 }
                }
            ])
            .png()
            .toBuffer();
    }

    private resolveAspectRatio(width: number, height: number): string {
        const ratio = width / height;
        let best: (typeof SUPPORTED_ASPECT_RATIOS)[number] = SUPPORTED_ASPECT_RATIOS[0];
        let bestDelta = Number.POSITIVE_INFINITY;

        for (const candidate of SUPPORTED_ASPECT_RATIOS) {
            const [w, h] = candidate.split(':').map(Number);
            const candidateRatio = w / h;
            const delta = Math.abs(candidateRatio - ratio);
            if (delta < bestDelta) {
                best = candidate;
                bestDelta = delta;
            }
        }

        return best;
    }

    private resolveImageSize(width: number, height: number): '1K' | '2K' | '4K' {
        const maxEdge = Math.max(width, height);
        if (maxEdge >= 2304) return '4K';
        if (maxEdge >= 1152) return '2K';
        return '1K';
    }

    private async encodeImageDataUrl(
        imageBuffer: Buffer,
        role: 'source' | 'mask' | 'guide'
    ): Promise<string> {
        const pipeline = sharp(imageBuffer).rotate();
        let output = role === 'mask'
            ? await pipeline.png().toBuffer()
            : await pipeline.webp({ quality: 92 }).toBuffer();

        if (output.length <= MAX_INLINE_IMAGE_BYTES) {
            return this.toDataUrl(output, role === 'mask' ? 'image/png' : 'image/webp');
        }

        let working = imageBuffer;
        let scale = 1;
        const qualities = role === 'mask' ? [100] : [88, 84, 78, 72, 66, 60];

        for (const quality of qualities) {
            for (const nextScale of [scale, 0.92, 0.86, 0.8]) {
                const metadata = await sharp(working).metadata();
                const width = Math.max(1, Math.round((metadata.width || 1) * nextScale));
                const height = Math.max(1, Math.round((metadata.height || 1) * nextScale));
                const resizedPipeline = sharp(working).resize(width, height, { fit: 'inside', withoutEnlargement: true });
                const resized = role === 'mask'
                    ? await resizedPipeline.png().toBuffer()
                    : await resizedPipeline.webp({ quality }).toBuffer();
                if (resized.length <= MAX_INLINE_IMAGE_BYTES) {
                    return this.toDataUrl(resized, role === 'mask' ? 'image/png' : 'image/webp');
                }
                output = resized;
                scale = nextScale;
            }
        }

        if (output.length > MAX_INLINE_IMAGE_BYTES) {
            throw this.createStageError(
                `Prepared ${role} image exceeds OpenRouter inline limit (${Math.round(output.length / 1024 / 1024)} MB)`,
                'provider-validate'
            );
        }

        return this.toDataUrl(output, role === 'mask' ? 'image/png' : 'image/webp');
    }

    private toDataUrl(buffer: Buffer, mimeType: string): string {
        return `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    private extractImageUrl(payload: OpenRouterChatCompletionResponse): string {
        const images = payload?.choices?.[0]?.message?.images;
        if (!Array.isArray(images) || images.length === 0) {
            return '';
        }
        for (const item of images) {
            const url = String(item?.image_url?.url || item?.imageUrl?.url || '').trim();
            if (url) return url;
        }
        return '';
    }

    private extractResponseText(payload: OpenRouterChatCompletionResponse): string {
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
            return content.trim();
        }
        if (Array.isArray(content)) {
            return content
                .map((item) => String(item?.text || '').trim())
                .filter(Boolean)
                .join('\n');
        }
        return '';
    }

    private async resolveImageUrl(url: string): Promise<{
        image: Buffer;
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    }> {
        const trimmed = String(url || '').trim();
        if (!trimmed) {
            throw this.createStageError('OpenRouter image URL is empty', 'provider-ready');
        }

        if (/^data:image\/[^;]+;base64,/i.test(trimmed)) {
            const mimeMatch = trimmed.match(/^data:(image\/[^;]+);base64,/i);
            const mimeType = this.normalizeMimeType(mimeMatch?.[1]);
            const base64 = trimmed.replace(/^data:image\/[^;]+;base64,/i, '');
            return {
                image: Buffer.from(base64, 'base64'),
                mimeType
            };
        }

        const response = await axios.get<ArrayBuffer>(trimmed, {
            responseType: 'arraybuffer',
            timeout: 90_000,
            ...getAxiosProxyConfig()
        });
        const mimeType = this.normalizeMimeType(String(response.headers['content-type'] || 'image/png'));
        return {
            image: Buffer.from(response.data),
            mimeType
        };
    }

    private normalizeMimeType(mimeType?: string): 'image/png' | 'image/jpeg' | 'image/webp' {
        const normalized = String(mimeType || '').trim().toLowerCase();
        if (normalized.includes('webp')) return 'image/webp';
        if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'image/jpeg';
        return 'image/png';
    }

    private wrapAxiosError(error: any): ServiceError {
        const status = Number(error?.response?.status || 0);
        const payload = error?.response?.data;
        const errorMessage = String(
            payload?.error?.message ||
            payload?.message ||
            error?.message ||
            'OpenRouter request failed'
        ).trim();
        const stage = status === 401 || status === 403 ? 'provider-validate' : 'provider-submit';
        const serviceError = new Error(`OpenRouter request failed: ${errorMessage}`) as ServiceError;
        serviceError.errorStage = stage;
        serviceError.errorCode = String(payload?.error?.code || status || '').trim();
        serviceError.errorDetail = errorMessage;
        serviceError.provider = 'openrouter';
        return serviceError;
    }

    private createStageError(message: string, stage: ServiceError['errorStage']): ServiceError {
        const error = new Error(message) as ServiceError;
        error.errorStage = stage;
        error.provider = 'openrouter';
        return error;
    }
}

export const openRouterGeminiImageService = new OpenRouterGeminiImageService();
