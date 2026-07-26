import axios from 'axios';
import { getAxiosProxyConfig } from './network-proxy';

export type GPTsAPIGeminiImageModel = 'gemini-3-pro-image-preview';
export type GPTsAPIImageOutputFormat = 'jpeg' | 'png' | 'webp';

export interface GPTsAPIGeminiImageProgressEvent {
    progress: number;
    stage:
        | 'provider-validate'
        | 'provider-submit'
        | 'provider-polling'
        | 'provider-ready'
        | 'provider-download';
    message: string;
}

export type GPTsAPIGeminiImageProgressCallback = (event: GPTsAPIGeminiImageProgressEvent) => void;

export interface GPTsAPIGeminiImageResult {
    image: Buffer;
    model: GPTsAPIGeminiImageModel;
    outputFormat: GPTsAPIImageOutputFormat;
    requestId?: string;
}

type GPTsAPISubmitResponse = {
    code?: number;
    message?: string;
    data?: {
        id?: string;
        model?: string;
        status?: string;
        outputs?: unknown[];
        urls?: {
            get?: string;
        };
    };
    urls?: {
        get?: string;
    };
};

type GPTsAPIResultResponse = {
    code?: number;
    message?: string;
    error?: string;
    data?: {
        id?: string;
        model?: string;
        status?: string;
        outputs?: unknown[];
        urls?: {
            get?: string;
        };
    };
    outputs?: unknown[];
    status?: string;
};

const GPTSAPI_IMAGE_EDIT_ENDPOINT = 'https://api.gptsapi.net/api/v3/google/gemini-3-pro-image-preview/image-edit';
const GPTSAPI_RESULT_ENDPOINT_BASE = 'https://api.gptsapi.net/api/v3/predictions';
const DEFAULT_MODEL: GPTsAPIGeminiImageModel = 'gemini-3-pro-image-preview';
const DEFAULT_OUTPUT_FORMAT: GPTsAPIImageOutputFormat = 'jpeg';
export class GPTsAPIGeminiImageService {
    private apiKey = '';

    setApiKey(apiKey?: string): void {
        this.apiKey = String(apiKey || '').trim();
    }

    hasApiKey(): boolean {
        return this.apiKey.length > 0;
    }

    async generateFromImage(
        prompt: string,
        imageDataUrl: string,
        options?: {
            model?: GPTsAPIGeminiImageModel | string;
            outputFormat?: GPTsAPIImageOutputFormat | string;
            referenceImages?: string[];
            timeoutMs?: number;
            pollIntervalMs?: number;
        },
        onProgress?: GPTsAPIGeminiImageProgressCallback
    ): Promise<GPTsAPIGeminiImageResult> {
        if (!this.hasApiKey()) {
            throw new Error('GPTs API key is not configured');
        }

        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) {
            throw new Error('Prompt is required');
        }

        const normalizedImage = this.normalizeImageInput(String(imageDataUrl || '').trim());
        if (!normalizedImage) {
            throw new Error('Source image is required');
        }

        const referenceImages = Array.isArray(options?.referenceImages)
            ? options!.referenceImages
                .map((item) => this.normalizeImageInput(String(item || '').trim()))
                .filter(Boolean)
            : [];

        const model = this.normalizeModel(options?.model);
        const outputFormat = this.normalizeOutputFormat(options?.outputFormat);
        const timeoutMs = Math.max(30_000, options?.timeoutMs || 5 * 60 * 1000);
        const pollIntervalMs = Math.max(1_200, options?.pollIntervalMs || 2_000);
        const images = [normalizedImage, ...referenceImages];

        onProgress?.({
            progress: 10,
            stage: 'provider-validate',
            message: 'Validating GPTs API image edit request'
        });

        onProgress?.({
            progress: 28,
            stage: 'provider-submit',
            message: 'Submitting image edit request to GPTs API'
        });

        let submitResponse;
        try {
            submitResponse = await axios.post<GPTsAPISubmitResponse>(
                GPTSAPI_IMAGE_EDIT_ENDPOINT,
                {
                    prompt: cleanPrompt,
                    images,
                    output_format: outputFormat
                },
                this.createRequestConfig(Math.min(timeoutMs, 60_000))
            );
        } catch (error: any) {
            throw new Error(this.wrapAxiosError('request', error));
        }

        const submitPayload = submitResponse.data;
        if (
            submitResponse.status >= 400 ||
            (typeof submitPayload?.code === 'number' && submitPayload.code >= 400)
        ) {
            throw new Error(this.formatSubmitError(submitResponse.status, submitPayload));
        }

        const requestId = String(submitPayload?.data?.id || '').trim();
        const resultUrl = String(
            submitPayload?.data?.urls?.get ||
            submitPayload?.urls?.get ||
            (requestId ? `${GPTSAPI_RESULT_ENDPOINT_BASE}/${requestId}/result` : '')
        ).trim();

        if (!requestId || !resultUrl) {
            throw new Error('GPTsAPI request failed: Missing result polling URL');
        }

        const startTime = Date.now();
        let pollCount = 0;

        while (Date.now() - startTime < timeoutMs) {
            pollCount += 1;
            const progress = Math.min(88, 36 + pollCount * 8);

            onProgress?.({
                progress,
                stage: 'provider-polling',
                message: `Polling GPTs API result (${pollCount})`
            });

            let resultResponse;
            try {
                resultResponse = await axios.get<GPTsAPIResultResponse>(
                    resultUrl,
                    this.createRequestConfig(45_000)
                );
            } catch (error: any) {
                throw new Error(this.wrapAxiosError('result', error));
            }

            const resultPayload = resultResponse.data;
            if (
                resultResponse.status >= 400 ||
                (typeof resultPayload?.code === 'number' && resultPayload.code >= 400)
            ) {
                throw new Error(this.formatResultError(resultResponse.status, resultPayload));
            }

            const status = String(resultPayload?.data?.status || resultPayload?.status || '').trim().toLowerCase();
            const outputSource = this.extractOutputSource(resultPayload);

            if (outputSource) {
                onProgress?.({
                    progress: 92,
                    stage: 'provider-ready',
                    message: 'GPTs API returned image result'
                });

                const image = await this.resolveOutputSource(outputSource, onProgress);
                return {
                    image,
                    model,
                    outputFormat,
                    requestId
                };
            }

            if (this.isFailureStatus(status)) {
                const errorMessage = String(
                    resultPayload?.error ||
                    resultPayload?.message ||
                    resultPayload?.data?.status ||
                    'Unknown provider error'
                ).trim();
                throw new Error(`GPTsAPI result failed: ${errorMessage}`);
            }

            if (!this.isPendingStatus(status)) {
                throw new Error('GPTsAPI result payload is missing image data');
            }

            await this.sleep(pollIntervalMs);
        }

        throw new Error('GPTsAPI request timed out while waiting for image result');
    }

    private normalizeModel(model?: string): GPTsAPIGeminiImageModel {
        return String(model || '').trim() === DEFAULT_MODEL ? DEFAULT_MODEL : DEFAULT_MODEL;
    }

    private normalizeOutputFormat(outputFormat?: string): GPTsAPIImageOutputFormat {
        const normalized = String(outputFormat || '').trim().toLowerCase();
        if (normalized === 'png' || normalized === 'webp') {
            return normalized;
        }
        return DEFAULT_OUTPUT_FORMAT;
    }

    private normalizeImageInput(imageData: string): string {
        const trimmed = String(imageData || '').trim();
        if (!trimmed) return '';
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^data:image\/[^;]+;base64,/i.test(trimmed)) {
            return trimmed.replace(/^data:image\/[^;]+;base64,/i, '');
        }
        return trimmed;
    }

    private extractOutputSource(payload: GPTsAPIResultResponse): string {
        const outputs = this.collectOutputs(payload);
        for (const item of outputs) {
            const source = this.findOutputValue(item);
            if (source) return source;
        }
        return '';
    }

    private collectOutputs(payload: GPTsAPIResultResponse): unknown[] {
        const directOutputs = Array.isArray(payload?.outputs) ? payload.outputs : [];
        const nestedOutputs = Array.isArray(payload?.data?.outputs) ? payload.data.outputs : [];
        return [...nestedOutputs, ...directOutputs];
    }

    private findOutputValue(item: unknown): string {
        if (typeof item === 'string') {
            return item.trim();
        }
        if (!item || typeof item !== 'object') {
            return '';
        }

        const record = item as Record<string, unknown>;
        const candidates = [
            record.url,
            record.image_url,
            record.output_url,
            record.download_url,
            record.src,
            record.value,
            record.b64_json,
            record.base64,
            record.image
        ];

        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate.trim();
            }
        }

        return '';
    }

    private async resolveOutputSource(
        outputSource: string,
        onProgress?: GPTsAPIGeminiImageProgressCallback
    ): Promise<Buffer> {
        const trimmed = String(outputSource || '').trim();
        if (!trimmed) {
            throw new Error('GPTsAPI result payload is missing image data');
        }

        if (/^data:image\/[^;]+;base64,/i.test(trimmed)) {
            const base64 = trimmed.replace(/^data:image\/[^;]+;base64,/i, '');
            return Buffer.from(base64, 'base64');
        }

        if (/^https?:\/\//i.test(trimmed)) {
            onProgress?.({
                progress: 96,
                stage: 'provider-download',
                message: 'Downloading GPTs API image result'
            });
            try {
                const response = await axios.get<ArrayBuffer>(trimmed, {
                    responseType: 'arraybuffer',
                    timeout: 120_000,
                    ...getAxiosProxyConfig()
                });
                return Buffer.from(response.data);
            } catch (error: any) {
                throw new Error(this.wrapAxiosError('download', error));
            }
        }

        if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 128) {
            return Buffer.from(trimmed, 'base64');
        }

        throw new Error('GPTsAPI result payload is missing image data');
    }

    private isPendingStatus(status: string): boolean {
        return ['created', 'queued', 'pending', 'processing', 'running', 'in_progress'].includes(status);
    }

    private isFailureStatus(status: string): boolean {
        return ['failed', 'error', 'canceled', 'cancelled'].includes(status);
    }

    private createRequestConfig(timeout: number) {
        return {
            timeout,
            validateStatus: () => true,
            ...getAxiosProxyConfig(),
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        };
    }

    private wrapAxiosError(stage: 'request' | 'result' | 'download', error: any): string {
        const code = String(error?.code || '').trim();
        const errno = String(error?.errno || '').trim();
        const rawMessage = String(error?.message || '').trim();
        const address = String(error?.address || '').trim();
        const port = error?.port ? `:${String(error.port).trim()}` : '';
        const target = address ? ` ${address}${port}` : '';

        if (code === 'ETIMEDOUT' || errno === 'ETIMEDOUT' || /connect etimedout/i.test(rawMessage)) {
            return `GPTsAPI ${stage} failed: Network timeout while connecting to api.gptsapi.net${target}`;
        }

        if (code === 'ENOTFOUND' || /getaddrinfo enotfound|dns/i.test(rawMessage)) {
            return `GPTsAPI ${stage} failed: DNS lookup failed for api.gptsapi.net`;
        }

        if (code === 'ECONNREFUSED') {
            return `GPTsAPI ${stage} failed: Connection refused by remote host${target}`;
        }

        if (code === 'ECONNRESET') {
            return `GPTsAPI ${stage} failed: Connection reset by remote host${target}`;
        }

        if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
            return `GPTsAPI ${stage} failed: Network route is unreachable${target}`;
        }

        return `GPTsAPI ${stage} failed: ${rawMessage || 'Unknown network error'}`;
    }

    private formatSubmitError(statusCode: number, payload?: GPTsAPISubmitResponse): string {
        const providerCode = payload?.code;
        const providerMessage = String(payload?.message || '').trim();
        const codeSuffix = providerCode ? ` (code=${providerCode})` : '';
        if (statusCode === 401 || statusCode === 403 || providerCode === 401 || providerCode === 403) {
            return `GPTsAPI request failed: Unauthorized${codeSuffix}`;
        }
        return `GPTsAPI request failed: ${providerMessage || `HTTP ${statusCode}`}${codeSuffix}`;
    }

    private formatResultError(statusCode: number, payload?: GPTsAPIResultResponse): string {
        const providerCode = payload?.code;
        const providerMessage = String(payload?.error || payload?.message || '').trim();
        const codeSuffix = providerCode ? ` (code=${providerCode})` : '';
        if (statusCode === 401 || statusCode === 403 || providerCode === 401 || providerCode === 403) {
            return `GPTsAPI result failed: Unauthorized${codeSuffix}`;
        }
        return `GPTsAPI result failed: ${providerMessage || `HTTP ${statusCode}`}${codeSuffix}`;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export const gptsapiGeminiImageService = new GPTsAPIGeminiImageService();
