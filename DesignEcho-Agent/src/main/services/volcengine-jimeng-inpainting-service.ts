import axios from 'axios';
import { Service } from '@volcengine/openapi';
import sharp from 'sharp';
import {
    applyVolcProxyEnvironment,
    getAxiosProxyConfig,
    restoreVolcProxyEnvironment
} from './network-proxy';

export interface JimengInpaintingProgressEvent {
    progress: number;
    stage:
        | 'provider-submit'
        | 'provider-queued'
        | 'provider-generating'
        | 'provider-ready'
        | 'provider-download';
    message: string;
}

export type JimengInpaintingProgressCallback = (event: JimengInpaintingProgressEvent) => void;

export interface JimengInpaintingResult {
    image: Buffer;
    taskId: string;
    requestId?: string;
}

type JimengProviderError = Error & {
    errorStage?: string;
    errorCode?: string;
    errorDetail?: string;
    requestId?: string;
    provider?: 'jimeng';
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
const JIMENG_REQ_KEY = 'jimeng_image2image_dream_inpaint';
const JIMENG_QUERY_OPTIONS = JSON.stringify({
    return_url: true,
    logo_info: {
        add_logo: false
    }
});

export class VolcengineJimengInpaintingService {
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
    }

    hasCredentials(): boolean {
        return Boolean(this.service.getAccessKeyId()?.trim() && this.service.getSecretKey()?.trim());
    }

    async testCredentials(
        accessKeyId?: string,
        secretAccessKey?: string
    ): Promise<{ success: boolean; message?: string; error?: string }> {
        const ak = String(accessKeyId ?? '').trim();
        const sk = String(secretAccessKey ?? '').trim();
        if (!ak || !sk) {
            return { success: false, error: '请先输入 Access Key ID 和 Secret Access Key' };
        }

        try {
            const { submitTask: probeSubmitTask } = this.createService(ak, sk);
            const probePayload = await this.createProbePayload();
            const submitResponse = await this.withVolcProxyAccess(async () => (
                await probeSubmitTask({
                    req_key: JIMENG_REQ_KEY,
                    binary_data_base64: [
                        probePayload.sourceImage.toString('base64'),
                        probePayload.maskImage.toString('base64')
                    ],
                    prompt: '将选区替换为浅灰色纯色背景',
                    seed: 101
                }) as JimengSubmitResponse
            ));

            if (submitResponse?.code === 10000 && String(submitResponse?.data?.task_id || '').trim()) {
                return { success: true, message: '连通性正常，鉴权和提交链已通过' };
            }

            if (String(submitResponse?.code || '').trim() === '50430') {
                return { success: true, message: '鉴权和提交链正常，但当前即梦并发已满，请稍后重试' };
            }

            return {
                success: false,
                error: this.createApiError('即梦AI 提交测试失败', submitResponse, 'provider-submit').errorDetail
            };
        } catch (error: any) {
            const sdkError = this.extractSdkErrorInfo(error);
            const rawMessage = sdkError.message;
            const lower = rawMessage.toLowerCase();

            if (lower.includes('signature') || lower.includes('access key') || lower.includes('auth')) {
                return { success: false, error: 'Access Key 无效或无权限' };
            }

            if (lower.includes('econnrefused') && (rawMessage.includes('::1:80') || rawMessage.includes('127.0.0.1:80'))) {
                return { success: false, error: '本地代理连接失败（::1:80）。即梦请求被导向本机代理，请检查代理设置。' };
            }

            return { success: false, error: sdkError.detail || rawMessage || '网络连接失败' };
        }
    }

    async inpaint(
        prompt: string,
        sourceImage: Buffer,
        maskImage: Buffer,
        onProgress?: JimengInpaintingProgressCallback,
        options?: { seed?: number; timeoutMs?: number; pollIntervalMs?: number }
    ): Promise<JimengInpaintingResult> {
        if (!this.hasCredentials()) {
            throw this.createStageError(
                '即梦AI Access Key ID / Secret Access Key 未配置',
                'provider-auth',
                { detail: '请先在设置中填写即梦AI 的 Access Key ID 和 Secret Access Key。' }
            );
        }

        const timeoutMs = Math.max(30_000, options?.timeoutMs || 5 * 60 * 1000);
        const pollIntervalMs = Math.max(1200, options?.pollIntervalMs || 2000);

        onProgress?.({
            progress: 30,
            stage: 'provider-submit',
            message: 'Submitting inpainting task to Jimeng'
        });

        let submitResponse: JimengSubmitResponse;
        try {
            submitResponse = await this.withVolcProxyAccess(async () => (
                await this.submitTask({
                    req_key: JIMENG_REQ_KEY,
                    binary_data_base64: [
                        sourceImage.toString('base64'),
                        maskImage.toString('base64')
                    ],
                    prompt: prompt.trim(),
                    seed: typeof options?.seed === 'number' ? options.seed : 101
                }) as JimengSubmitResponse
            ));
        } catch (error: any) {
            throw this.wrapSdkError('即梦AI 提交任务失败', 'provider-submit', error);
        }

        const taskId = String(submitResponse?.data?.task_id || '').trim();
        if (submitResponse?.code !== 10000 || !taskId) {
            throw this.createApiError('即梦AI 提交任务失败', submitResponse, 'provider-submit');
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
                throw this.wrapSdkError('即梦AI 查询任务失败', 'provider-query', error);
            }

            if (queryResponse?.code !== 10000) {
                throw this.createApiError('即梦AI 查询任务失败', queryResponse, 'provider-query');
            }

            const status = String(queryResponse?.data?.status || '').trim();
            if (status !== lastStatus) {
                lastStatus = status;
                if (status === 'in_queue') {
                    onProgress?.({
                        progress: 44,
                        stage: 'provider-queued',
                        message: 'Jimeng task queued'
                    });
                } else if (status === 'generating') {
                    onProgress?.({
                        progress: 68,
                        stage: 'provider-generating',
                        message: 'Jimeng is generating result'
                    });
                } else if (status === 'done') {
                    onProgress?.({
                        progress: 88,
                        stage: 'provider-ready',
                        message: 'Jimeng returned result'
                    });
                }
            }

            if (status === 'done') {
                const image = await this.resolveResultImage(queryResponse, taskId, onProgress);
                return {
                    image,
                    taskId,
                    requestId: String(queryResponse?.request_id || '').trim() || undefined
                };
            }

            if (status === 'not_found') {
                throw this.createStageError(
                    `即梦AI 任务不存在或已过期: ${taskId}`,
                    'provider-query',
                    { requestId: String(queryResponse?.request_id || '').trim() || undefined }
                );
            }

            if (status === 'expired') {
                throw this.createStageError(
                    `即梦AI 任务已过期: ${taskId}`,
                    'provider-query',
                    { requestId: String(queryResponse?.request_id || '').trim() || undefined }
                );
            }

            await this.sleep(pollIntervalMs);
        }

        throw this.createStageError(`即梦AI 任务超时: ${taskId}`, 'provider-query');
    }

    private async resolveResultImage(
        response: JimengQueryResponse,
        taskId: string,
        onProgress?: JimengInpaintingProgressCallback
    ): Promise<Buffer> {
        const base64 = String(response?.data?.binary_data_base64?.[0] || '').trim();
        if (base64) {
            onProgress?.({
                progress: 92,
                stage: 'provider-download',
                message: 'Decoding Jimeng result'
            });
            return Buffer.from(base64, 'base64');
        }

        const imageUrl = String(response?.data?.image_urls?.[0] || '').trim();
        if (!imageUrl) {
            throw this.createStageError(`即梦AI 未返回结果图: ${taskId}`, 'provider-download', {
                requestId: String(response?.request_id || '').trim() || undefined
            });
        }

        onProgress?.({
            progress: 92,
            stage: 'provider-download',
            message: 'Downloading Jimeng result'
        });

        try {
            const downloadResponse = await axios.get<ArrayBuffer>(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 120_000,
                ...getAxiosProxyConfig()
            });
            return Buffer.from(downloadResponse.data);
        } catch (error: any) {
            throw this.wrapSdkError('即梦AI 下载结果失败', 'provider-download', error);
        }
    }

    private createService(accessKeyId?: string, secretAccessKey?: string) {
        applyVolcProxyEnvironment();
        const service = new Service({
            serviceName: 'cv',
            region: 'cn-north-1',
            host: 'visual.volcengineapi.com',
            protocol: 'https:'
        });

        if (accessKeyId !== undefined) {
            service.setAccessKeyId(accessKeyId || '');
        }
        if (secretAccessKey !== undefined) {
            service.setSecretKey(secretAccessKey || '');
        }

        return {
            service,
            submitTask: service.createJSONAPI(JIMENG_ACTION_SUBMIT, { Version: JIMENG_VERSION }),
            queryTask: service.createJSONAPI(JIMENG_ACTION_QUERY, { Version: JIMENG_VERSION })
        };
    }

    private async withVolcProxyAccess<T>(fn: () => Promise<T>): Promise<T> {
        const previous = applyVolcProxyEnvironment();

        try {
            return await fn();
        } finally {
            restoreVolcProxyEnvironment(previous);
        }
    }

    private async createProbePayload(): Promise<{ sourceImage: Buffer; maskImage: Buffer }> {
        const width = 128;
        const height = 128;
        const maskRaw = Buffer.alloc(width * height, 0);
        for (let y = 32; y < 96; y += 1) {
            for (let x = 32; x < 96; x += 1) {
                maskRaw[y * width + x] = 255;
            }
        }

        const sourceImage = await sharp({
            create: {
                width,
                height,
                channels: 3,
                background: { r: 242, g: 242, b: 242 }
            }
        }).png().toBuffer();

        const maskImage = await sharp(maskRaw, {
            raw: {
                width,
                height,
                channels: 1
            }
        }).png().toBuffer();

        return { sourceImage, maskImage };
    }

    private extractSdkErrorInfo(error: any): {
        message: string;
        code: string;
        requestId: string;
        detail: string;
    } {
        const responseData = error?.response?.data || error?.data || null;
        const message = String(
            responseData?.message ||
            responseData?.Message ||
            responseData?.error?.message ||
            error?.message ||
            ''
        ).trim();
        const code = String(
            responseData?.code ||
            responseData?.Code ||
            responseData?.error?.code ||
            error?.code ||
            ''
        ).trim();
        const requestId = String(
            responseData?.request_id ||
            responseData?.RequestId ||
            error?.requestId ||
            error?.metadata?.RequestId ||
            ''
        ).trim();
        const detail = requestId
            ? `${message || 'request failed'}${code ? ` (code=${code})` : ''}, request_id=${requestId}`
            : `${message || 'request failed'}${code ? ` (code=${code})` : ''}`;

        return {
            message: message || String(error?.message || '').trim(),
            code,
            requestId,
            detail
        };
    }

    private createApiError(
        prefix: string,
        response: { code?: number; message?: string; request_id?: string } | null | undefined,
        stage: string
    ): JimengProviderError {
        const code = typeof response?.code === 'number' ? String(response.code) : 'unknown';
        const message = String(response?.message || 'unknown error').trim() || 'unknown error';
        const requestId = String(response?.request_id || '').trim();
        const detail = requestId
            ? `${prefix}: ${message} (code=${code}, request_id=${requestId})`
            : `${prefix}: ${message} (code=${code})`;
        return this.createStageError(prefix, stage, {
            code,
            requestId: requestId || undefined,
            detail
        });
    }

    private wrapSdkError(prefix: string, stage: string, error: any): JimengProviderError {
        const sdkError = this.extractSdkErrorInfo(error);
        const rawMessage = sdkError.message;
        const lower = rawMessage.toLowerCase();

        if (lower.includes('econnrefused') && (rawMessage.includes('::1:80') || rawMessage.includes('127.0.0.1:80'))) {
            return this.createStageError(prefix, stage, {
                code: sdkError.code,
                requestId: sdkError.requestId || undefined,
                detail: '连接本地代理失败（::1:80）。即梦请求被导向本机代理，请检查 VOLC_PROXY_HOST / VOLC_PROXY_PORT 或系统代理设置。'
            });
        }

        return this.createStageError(prefix, stage, {
            code: sdkError.code,
            requestId: sdkError.requestId || undefined,
            detail: sdkError.detail || rawMessage || prefix
        });
    }

    private createStageError(
        message: string,
        stage: string,
        options?: {
            code?: string;
            requestId?: string;
            detail?: string;
        }
    ): JimengProviderError {
        const error = new Error(message) as JimengProviderError;
        error.errorStage = stage;
        error.errorCode = options?.code || '';
        error.errorDetail = options?.detail || message;
        error.requestId = options?.requestId || '';
        error.provider = 'jimeng';
        return error;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export const volcengineJimengInpaintingService = new VolcengineJimengInpaintingService();
