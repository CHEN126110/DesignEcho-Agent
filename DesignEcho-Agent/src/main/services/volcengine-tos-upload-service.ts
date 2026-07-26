import path from 'path';
import { randomUUID } from 'crypto';
import TosClient, { ACLType, TosClientError, TosServerError } from '@volcengine/tos-sdk';

type TosUploadError = Error & {
    errorStage?: string;
    errorCode?: string;
    errorDetail?: string;
};

export interface VolcengineTosUploadConfig {
    region?: string;
    endpoint?: string;
    bucket?: string;
    publicBaseUrl?: string;
    keyPrefix?: string;
}

export class VolcengineTosUploadService {
    private accessKeyId = '';
    private secretAccessKey = '';
    private config: Required<VolcengineTosUploadConfig> = {
        region: '',
        endpoint: '',
        bucket: '',
        publicBaseUrl: '',
        keyPrefix: 'designecho/jimeng-i2i'
    };

    setCredentials(accessKeyId?: string, secretAccessKey?: string): void {
        if (accessKeyId !== undefined) {
            this.accessKeyId = String(accessKeyId || '').trim();
        }
        if (secretAccessKey !== undefined) {
            this.secretAccessKey = String(secretAccessKey || '').trim();
        }
    }

    setConfig(config?: VolcengineTosUploadConfig): void {
        if (!config || typeof config !== 'object') {
            return;
        }
        if (config.region !== undefined) this.config.region = String(config.region || '').trim();
        if (config.endpoint !== undefined) this.config.endpoint = String(config.endpoint || '').trim();
        if (config.bucket !== undefined) this.config.bucket = String(config.bucket || '').trim();
        if (config.publicBaseUrl !== undefined) this.config.publicBaseUrl = String(config.publicBaseUrl || '').trim().replace(/\/+$/, '');
        if (config.keyPrefix !== undefined) {
            this.config.keyPrefix = String(config.keyPrefix || '').trim().replace(/^\/+|\/+$/g, '') || 'designecho/jimeng-i2i';
        }
    }

    hasReadyConfig(): boolean {
        return Boolean(
            this.accessKeyId &&
            this.secretAccessKey &&
            this.config.region &&
            this.config.endpoint &&
            this.config.bucket &&
            this.config.publicBaseUrl
        );
    }

    getMissingConfigFields(): string[] {
        const missing: string[] = [];
        if (!this.accessKeyId) missing.push('即梦 Access Key ID');
        if (!this.secretAccessKey) missing.push('即梦 Secret Access Key');
        if (!this.config.region) missing.push('TOS Region');
        if (!this.config.endpoint) missing.push('TOS Endpoint');
        if (!this.config.bucket) missing.push('TOS Bucket');
        if (!this.config.publicBaseUrl) missing.push('TOS Public Base URL');
        return missing;
    }

    async uploadBuffer(
        buffer: Buffer,
        options?: {
            contentType?: string;
            extension?: string;
            purpose?: string;
        }
    ): Promise<{ objectKey: string; url: string }> {
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            throw this.createError('TOS 上传内容为空', 'upload-validate');
        }
        if (!this.hasReadyConfig()) {
            throw this.createError(
                `TOS 上传配置不完整：${this.getMissingConfigFields().join('、')}`,
                'upload-config'
            );
        }

        const client = new TosClient({
            accessKeyId: this.accessKeyId,
            accessKeySecret: this.secretAccessKey,
            region: this.config.region,
            endpoint: this.config.endpoint
        });

        const extension = String(options?.extension || '.jpg').trim();
        const safeExt = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
        const purpose = String(options?.purpose || 'source').trim().replace(/[^a-z0-9_-]+/gi, '-') || 'source';
        const objectKey = [
            this.config.keyPrefix,
            new Date().toISOString().slice(0, 10),
            `${purpose}_${Date.now()}_${randomUUID().slice(0, 8)}${safeExt}`
        ].filter(Boolean).join('/');

        try {
            await client.putObject({
                bucket: this.config.bucket,
                key: objectKey,
                body: buffer,
                contentType: String(options?.contentType || 'image/jpeg').trim() || 'image/jpeg',
                acl: ACLType.ACLPublicRead
            });
        } catch (error: any) {
            throw this.wrapUploadError(error, objectKey);
        }

        const encodedKey = objectKey
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');
        return {
            objectKey,
            url: `${this.config.publicBaseUrl}/${encodedKey}`
        };
    }

    private createError(message: string, stage: string, code?: string, detail?: string): TosUploadError {
        const error = new Error(message) as TosUploadError;
        error.errorStage = stage;
        error.errorCode = code || '';
        error.errorDetail = detail || message;
        return error;
    }

    private wrapUploadError(error: any, objectKey: string): TosUploadError {
        if (error instanceof TosServerError) {
            return this.createError(
                `TOS 上传失败: ${error.message}`,
                'upload-object',
                error.code,
                `bucket=${this.config.bucket}, key=${objectKey}, status=${error.statusCode}, requestId=${error.requestId}`
            );
        }
        if (error instanceof TosClientError) {
            return this.createError(
                `TOS 客户端错误: ${error.message}`,
                'upload-object',
                'TosClientError',
                error.stack || error.message
            );
        }
        return this.createError(
            `TOS 上传异常: ${error?.message || String(error)}`,
            'upload-object',
            '',
            error?.stack || String(error)
        );
    }
}

export const volcengineTosUploadService = new VolcengineTosUploadService();
