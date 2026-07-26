import axios from 'axios';
import sharp from 'sharp';
import { Service } from '@volcengine/openapi';
import { volcengineTosUploadService } from './volcengine-tos-upload-service';
import {
    applyVolcProxyEnvironment,
    getAxiosProxyConfig,
    restoreVolcProxyEnvironment
} from './network-proxy';

export type JimengImageSizePreset = '1K' | '2K' | '4K';

export interface JimengImageProgressEvent {
    progress: number;
    stage:
        | 'provider-validate'
        | 'provider-upload'
        | 'provider-submit'
        | 'provider-queued'
        | 'provider-generating'
        | 'provider-ready'
        | 'provider-download';
    message: string;
}

export type JimengImageProgressCallback = (event: JimengImageProgressEvent) => void;

export interface JimengImageGenerateResult {
    image: Buffer;
    model: 'jimeng-seedream-4-6';
    sizePreset: JimengImageSizePreset;
    taskId: string;
    requestId?: string;
}

type JimengProviderError = Error & {
    errorStage?: string;
    errorCode?: string;
    errorDetail?: string;
    requestId?: string;
};

type JimengSubmitResponse = {
    code?: number;
    message?: string;
    request_id?: string;
    data?: {
        task_id?: string;
    } | null;
};

type JimengQueryResponse = {
    code?: number;
    message?: string;
    request_id?: string;
    data?: {
        binary_data_base64?: string[] | null;
        image_urls?: string[] | null;
        status?: 'in_queue' | 'generating' | 'done' | 'not_found' | 'expired' | string;
    } | null;
};

const JIMENG_ACTION_SUBMIT = 'CVSync2AsyncSubmitTask';
const JIMENG_ACTION_QUERY = 'CVSync2AsyncGetResult';
const JIMENG_VERSION = '2022-08-31';
const JIMENG_REQ_KEY = 'jimeng_seedream46_cvtob';
const JIMENG_QUERY_OPTIONS = JSON.stringify({
    return_url: true,
    logo_info: {
        add_logo: false
    }
});

const JIMENG_SIZE_PRESET_TO_AREA: Record<JimengImageSizePreset, number> = {
    '1K': 1024 * 1024,
    '2K': 2048 * 2048,
    '4K': 4096 * 4096
};

const JIMENG_MAX_INPUT_BYTES = 15 * 1024 * 1024;
const JIMENG_MAX_EDGE = 4096;

export class VolcengineJimengImageService {
    private readonly service: Service;
    private readonly submitTask: (requestData: any, params?: any, options?: any) => Promise<any>;
    private readonly queryTask: (requestData: any, params?: any, options?: any) => Promise<any>;

    constructor() {
        applyVolcProxyEnvironment();
        this.service = new Service({
            serviceName: 'cv',
            region: 'cn-north-1',
            host: 'visual.volcengineapi.com',
            protocol: 'https:'
        });
        this.submitTask = this.service.createJSONAPI(JIMENG_ACTION_SUBMIT, { Version: JIMENG_VERSION });
        this.queryTask = this.service.createJSONAPI(JIMENG_ACTION_QUERY, { Version: JIMENG_VERSION });
    }

    setCredentials(accessKeyId?: string, secretAccessKey?: string): void {
        if (accessKeyId !== undefined) {
            this.service.setAccessKeyId(accessKeyId || '');
        }
        if (secretAccessKey !== undefined) {
            this.service.setSecretKey(secretAccessKey || '');
        }
        volcengineTosUploadService.setCredentials(accessKeyId, secretAccessKey);
    }

    hasCredentials(): boolean {
        return Boolean(this.service.getAccessKeyId()?.trim() && this.service.getSecretKey()?.trim());
    }

    async generateFromImage(
        prompt: string,
        sourceImageDataUrl: string,
        options?: {
            sizePreset?: JimengImageSizePreset | string;
            referenceImages?: string[];
            timeoutMs?: number;
            forceSingle?: boolean;
            scale?: number;
        },
        onProgress?: JimengImageProgressCallback
    ): Promise<JimengImageGenerateResult> {
        if (!this.hasCredentials()) {
            throw this.createStageError(
                '即梦AI Access Key ID / Secret Access Key 未配置',
                'provider-validate',
                { detail: '请先在设置中填写即梦AI 的 Access Key ID 和 Secret Access Key。' }
            );
        }
        if (!volcengineTosUploadService.hasReadyConfig()) {
            throw this.createStageError(
                `即梦图生图缺少 TOS 配置：${volcengineTosUploadService.getMissingConfigFields().join('、')}`,
                'provider-upload',
                { detail: '即梦 4.6 图生图官方只接受 image_urls。请先在设置中补齐 TOS Region、Endpoint、Bucket 与 Public Base URL。' }
            );
        }

        const cleanPrompt = String(prompt || '').trim();
        if (!cleanPrompt) {
            throw this.createStageError('Prompt is required', 'provider-validate');
        }

        const sizePreset = this.resolveSizePreset(options?.sizePreset);
        const referenceInputs = Array.isArray(options?.referenceImages)
            ? options.referenceImages.map((item) => String(item || '').trim()).filter(Boolean)
            : [];

        onProgress?.({
            progress: 10,
            stage: 'provider-validate',
            message: 'Validating Jimeng 4.6 image inputs'
        });

        const preparedImages = await Promise.all(
            [sourceImageDataUrl, ...referenceInputs].map((item, index) =>
                this.prepareImageInput(item, index === 0 ? 'source' : `reference-${index}`)
            )
        );

        onProgress?.({
            progress: 24,
            stage: 'provider-upload',
            message: 'Uploading source images to TOS'
        });

        const uploadedUrls: string[] = [];
        for (const image of preparedImages) {
            const uploaded = await volcengineTosUploadService.uploadBuffer(image.buffer, {
                contentType: image.mime,
                extension: image.extension,
                purpose: image.role
            });
            uploadedUrls.push(uploaded.url);
        }

        onProgress?.({
            progress: 38,
            stage: 'provider-submit',
            message: 'Submitting Jimeng 4.6 task'
        });

        const timeoutMs = Math.max(30_000, options?.timeoutMs || 5 * 60 * 1000);
        const payload = {
            req_key: JIMENG_REQ_KEY,
            image_urls: uploadedUrls,
            prompt: cleanPrompt,
            size: JIMENG_SIZE_PRESET_TO_AREA[sizePreset],
            force_single: options?.forceSingle !== false,
            scale: this.normalizeScale(options?.scale)
        };

        let submitResponse: JimengSubmitResponse;
        try {
            submitResponse = await this.withVolcProxyAccess(async () => (
                await this.submitTask(payload) as JimengSubmitResponse
            ));
        } catch (error: any) {
            throw this.wrapSdkError('即梦 4.6 提交任务失败', 'provider-submit', error);
        }

        const taskId = String(submitResponse?.data?.task_id || '').trim();
        if (submitResponse?.code !== 10000 || !taskId) {
            throw this.createApiError('即梦 4.6 提交任务失败', submitResponse, 'provider-submit');
        }

        const startedAt = Date.now();
        let lastStatus = '';
        while (Date.now() - startedAt < timeoutMs) {
            let queryResponse: JimengQueryResponse;
            try {
            queryResponse = await this.withVolcProxyAccess(async () => (
                    await this.queryTask({
                        req_key: JIMENG_REQ_KEY,
                        task_id: taskId,
                        req_json: JIMENG_QUERY_OPTIONS
                    }) as JimengQueryResponse
                ));
            } catch (error: any) {
                throw this.wrapSdkError('即梦 4.6 查询任务失败', 'provider-query', error);
            }

            if (queryResponse?.code !== 10000) {
                throw this.createApiError('即梦 4.6 查询任务失败', queryResponse, 'provider-query');
            }

            const status = String(queryResponse?.data?.status || '').trim();
            if (status !== lastStatus) {
                lastStatus = status;
                if (status === 'in_queue') {
                    onProgress?.({ progress: 52, stage: 'provider-queued', message: 'Jimeng 4.6 task queued' });
                } else if (status === 'generating') {
                    onProgress?.({ progress: 74, stage: 'provider-generating', message: 'Jimeng 4.6 is generating result' });
                } else if (status === 'done') {
                    onProgress?.({ progress: 88, stage: 'provider-ready', message: 'Jimeng 4.6 returned result' });
                }
            }

            if (status === 'done') {
                const image = await this.resolveResultImage(queryResponse, taskId, onProgress);
                return {
                    image,
                    model: 'jimeng-seedream-4-6',
                    sizePreset,
                    taskId,
                    requestId: String(queryResponse?.request_id || '').trim() || undefined
                };
            }

            if (status === 'not_found' || status === 'expired') {
                throw this.createStageError(`即梦 4.6 任务状态异常: ${status}`, 'provider-query', {
                    requestId: String(queryResponse?.request_id || '').trim() || undefined
                });
            }

            await this.sleep(1800);
        }

        throw this.createStageError('即梦 4.6 任务超时', 'provider-query');
    }

    private resolveSizePreset(requested?: string): JimengImageSizePreset {
        const normalized = String(requested || '').trim().toUpperCase();
        if (normalized === '1K' || normalized === '2K' || normalized === '4K') {
            return normalized;
        }
        return '2K';
    }

    private normalizeScale(scale?: number): number {
        const value = Number(scale);
        if (Number.isFinite(value)) {
            return Math.max(1, Math.min(100, Math.round(value)));
        }
        return 50;
    }

    private async prepareImageInput(
        imageData: string,
        role: string
    ): Promise<{ buffer: Buffer; mime: string; extension: string; role: string }> {
        const trimmed = String(imageData || '').trim();
        if (!trimmed) {
            throw this.createStageError(`${role} image is empty`, 'provider-validate');
        }

        const cleanBase64 = trimmed.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        if (!buffer.length) {
            throw this.createStageError(`${role} image decoded to 0 bytes`, 'provider-validate');
        }

        const metadata = await sharp(buffer).metadata();
        const width = Number(metadata.width) || 0;
        const height = Number(metadata.height) || 0;
        if (width <= 0 || height <= 0) {
            throw this.createStageError(`${role} image dimensions are invalid`, 'provider-validate');
        }

        const normalized = await sharp(buffer)
            .resize({
                width: JIMENG_MAX_EDGE,
                height: JIMENG_MAX_EDGE,
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
            .toBuffer();

        if (normalized.length > JIMENG_MAX_INPUT_BYTES) {
            const recompressed = await sharp(normalized)
                .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: '4:2:0' })
                .toBuffer();
            if (recompressed.length > JIMENG_MAX_INPUT_BYTES) {
                throw this.createStageError(
                    `${role} image exceeds Jimeng 15MB limit after recompression`,
                    'provider-validate'
                );
            }
            return { buffer: recompressed, mime: 'image/jpeg', extension: '.jpg', role };
        }

        return { buffer: normalized, mime: 'image/jpeg', extension: '.jpg', role };
    }

    private async resolveResultImage(
        response: JimengQueryResponse,
        taskId: string,
        onProgress?: JimengImageProgressCallback
    ): Promise<Buffer> {
        const base64 = String(response?.data?.binary_data_base64?.[0] || '').trim();
        if (base64) {
            onProgress?.({ progress: 92, stage: 'provider-download', message: 'Decoding Jimeng 4.6 result' });
            return Buffer.from(base64, 'base64');
        }

        const imageUrl = String(response?.data?.image_urls?.[0] || '').trim();
        if (!imageUrl) {
            throw this.createStageError(`即梦 4.6 未返回结果图: ${taskId}`, 'provider-download', {
                requestId: String(response?.request_id || '').trim() || undefined
            });
        }

        onProgress?.({ progress: 92, stage: 'provider-download', message: 'Downloading Jimeng 4.6 result' });
        try {
            const downloadResponse = await axios.get<ArrayBuffer>(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 120_000,
                ...getAxiosProxyConfig()
            });
            return Buffer.from(downloadResponse.data);
        } catch (error: any) {
            throw this.wrapSdkError('即梦 4.6 下载结果失败', 'provider-download', error);
        }
    }

    private createApiError(message: string, response: JimengSubmitResponse | JimengQueryResponse, stage: string): JimengProviderError {
        return this.createStageError(message, stage, {
            code: String(response?.code || ''),
            detail: String(response?.message || message),
            requestId: String(response?.request_id || '').trim() || undefined
        });
    }

    private createStageError(
        message: string,
        stage: string,
        options?: { code?: string; detail?: string; requestId?: string }
    ): JimengProviderError {
        const error = new Error(message) as JimengProviderError;
        error.errorStage = stage;
        error.errorCode = options?.code || '';
        error.errorDetail = options?.detail || message;
        error.requestId = options?.requestId;
        return error;
    }

    private wrapSdkError(message: string, stage: string, error: any): JimengProviderError {
        const detail = error?.message || String(error);
        return this.createStageError(`${message}: ${detail}`, stage, { detail });
    }

    private async withVolcProxyAccess<T>(fn: () => Promise<T>): Promise<T> {
        const previous = applyVolcProxyEnvironment();
        try {
            return await fn();
        } finally {
            restoreVolcProxyEnvironment(previous);
        }
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const volcengineJimengImageService = new VolcengineJimengImageService();
