/**
 * BFL (Black Forest Labs) FLUX 图像生成服务
 * 
 * 基于 black-forest-labs/skills TypeScript 客户端
 * 用于 DesignEcho 项目的 AI 图像生成功能
 */

// --- Types ---

export interface BFLGenerationResult {
    id: string;
    url: string;
    width: number;
    height: number;
    pollingCount: number;
    elapsedMs: number;
    raw: Record<string, unknown>;
}

export interface BFLGenerateOptions {
    width?: number;
    height?: number;
    seed?: number;
    safetyTolerance?: number;
    outputFormat?: 'png' | 'jpeg';
    webhookUrl?: string;
    webhookSecret?: string;
    timeout?: number;
    steps?: number;
    guidance?: number;
    promptUpsampling?: boolean;
}

export interface BFLI2IOptions extends BFLGenerateOptions {
    additionalImages?: string[];
}

export interface BFLProgressEvent {
    phase: 'submitted' | 'polling' | 'ready';
    model: string;
    generationId?: string;
    pollingCount?: number;
    elapsedMs: number;
    status?: string;
    progress?: number;
}

export type BFLProgressCallback = (event: BFLProgressEvent) => void;

export type BFLRegion = 'global' | 'eu' | 'us';

export type BFLModelType = 
    | 'flux-2-klein-4b'  // 最快，实时
    | 'flux-2-klein-9b'  // 快速，高质量
    | 'flux-2-pro'       // 生产级平衡
    | 'flux-2-max'       // 最高质量
    | 'flux-2-flex'      // 排版优化
    | 'flux-kontext'     // 上下文编辑
    | 'flux-kontext-max' // 最高质量编辑
    | 'flux-pro-1.1'     // FLUX 1.1 Pro
    | 'flux-fill';       // 局部重绘

// --- Errors ---

export class BFLError extends Error {
    constructor(
        message: string,
        public statusCode?: number,
        public errorCode?: string
    ) {
        super(message);
        this.name = 'BFLError';
    }
}

export class AuthenticationError extends BFLError {
    constructor(message: string) {
        super(message, 401, 'authentication_error');
        this.name = 'AuthenticationError';
    }
}

export class InsufficientCreditsError extends BFLError {
    constructor(message: string) {
        super(message, 402, 'insufficient_credits');
        this.name = 'InsufficientCreditsError';
    }
}

export class RateLimitError extends BFLError {
    constructor(message: string, public retryAfter: number = 5) {
        super(message, 429, 'rate_limit_exceeded');
        this.name = 'RateLimitError';
    }
}

export class ValidationError extends BFLError {
    constructor(message: string) {
        super(message, 400, 'validation_error');
        this.name = 'ValidationError';
    }
}

export class GenerationError extends BFLError {
    constructor(message: string) {
        super(message, undefined, 'generation_error');
        this.name = 'GenerationError';
    }
}

// --- Rate Limiter ---

class Semaphore {
    private permits: number;
    private waiting: Array<() => void> = [];

    constructor(permits: number) {
        this.permits = permits;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            return;
        }
        return new Promise((resolve) => {
            this.waiting.push(resolve);
        });
    }

    release(): void {
        if (this.waiting.length > 0) {
            const next = this.waiting.shift();
            next?.();
        } else {
            this.permits++;
        }
    }
}

// --- BFL Service ---

export class BFLService {
    private static readonly BASE_URLS: Record<BFLRegion, string> = {
        global: 'https://api.bfl.ai',
        eu: 'https://api.eu.bfl.ai',
        us: 'https://api.us.bfl.ai',
    };

    private apiKey: string = '';
    private baseUrl: string = BFLService.BASE_URLS.global;
    private timeout: number = 120000;
    private semaphore: Semaphore = new Semaphore(24);

    /**
     * 更新 API Key
     */
    setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
        console.log('[BFLService] API Key 已设置');
    }

    /**
     * 检查 API Key 是否已配置
     */
    hasApiKey(): boolean {
        return !!this.apiKey && this.apiKey.length > 10;
    }

    /**
     * 设置区域
     */
    setRegion(region: BFLRegion): void {
        this.baseUrl = BFLService.BASE_URLS[region];
        console.log(`[BFLService] 区域已设置为: ${region}`);
    }

    /**
     * 获取请求头
     */
    private getHeaders(): Record<string, string> {
        return {
            'x-key': this.apiKey,
            'Content-Type': 'application/json',
        };
    }

    /**
     * 文生图 - 从文本提示生成图像
     */
    async generateText2Image(
        model: BFLModelType,
        prompt: string,
        options: BFLGenerateOptions = {},
        onProgress?: BFLProgressCallback
    ): Promise<BFLGenerationResult> {
        if (!this.hasApiKey()) {
            throw new AuthenticationError('BFL API Key 未配置。请在设置中配置 Black Forest Labs API 密钥。');
        }

        const {
            width = 1024,
            height = 1024,
            seed,
            safetyTolerance = 2,
            outputFormat = 'png',
            webhookUrl,
            webhookSecret,
            timeout = this.timeout,
            steps,
            guidance,
        } = options;

        // 验证尺寸
        this.validateDimensions(width, height);

        // 构建请求体
        const payload: Record<string, unknown> = {
            prompt,
            width,
            height,
            safety_tolerance: safetyTolerance,
            output_format: outputFormat,
        };

        if (seed !== undefined) payload.seed = seed;
        if (webhookUrl) payload.webhook_url = webhookUrl;
        if (webhookSecret) payload.webhook_secret = webhookSecret;
        if (steps !== undefined) payload.steps = steps;
        if (guidance !== undefined) payload.guidance = guidance;

        // 限流请求
        await this.semaphore.acquire();
        try {
            return await this.submitAndPoll(model, payload, timeout, onProgress);
        } finally {
            this.semaphore.release();
        }
    }

    /**
     * 图生图 - 从图像 + 文本提示生成新图像
     * 
     * @param model 模型名称
     * @param prompt 编辑指令
     * @param inputImage 输入图像 URL（推荐）或 base64
     * @param options 额外选项
     */
    async generateImage2Image(
        model: BFLModelType,
        prompt: string,
        inputImage: string,
        options: BFLI2IOptions = {},
        onProgress?: BFLProgressCallback
    ): Promise<BFLGenerationResult> {
        if (!this.hasApiKey()) {
            throw new AuthenticationError('BFL API Key 未配置。请在设置中配置 Black Forest Labs API 密钥。');
        }

        const { additionalImages = [], timeout = this.timeout, ...rest } = options;

        const payload: Record<string, unknown> = {
            prompt,
            input_image: inputImage,
        };

        // 添加额外的参考图像
        additionalImages.slice(0, 7).forEach((img, i) => {
            payload[`input_image_${i + 2}`] = img;
        });

        // 添加其他参数
        if (rest.width) payload.width = rest.width;
        if (rest.height) payload.height = rest.height;
        if (rest.seed !== undefined) payload.seed = rest.seed;
        if (rest.outputFormat) payload.output_format = rest.outputFormat;
        if (rest.steps !== undefined) payload.steps = rest.steps;
        if (rest.guidance !== undefined) payload.guidance = rest.guidance;
        if (rest.safetyTolerance !== undefined) payload.safety_tolerance = rest.safetyTolerance;
        if (rest.promptUpsampling !== undefined) payload.prompt_upsampling = rest.promptUpsampling;
        if (rest.webhookUrl) payload.webhook_url = rest.webhookUrl;
        if (rest.webhookSecret) payload.webhook_secret = rest.webhookSecret;

        await this.semaphore.acquire();
        try {
            return await this.submitAndPoll(model, payload, timeout, onProgress);
        } finally {
            this.semaphore.release();
        }
    }

    /**
     * 局部重绘 (Inpainting)
     * 
     * @param prompt 编辑指令
     * @param inputImage 原始图像 URL 或 base64
     * @param maskImage 蒙版图像 URL 或 base64（白色区域将被重绘）
     */
    async inpaint(
        prompt: string,
        inputImage: string,
        maskImage: string,
        options: BFLGenerateOptions = {},
        onProgress?: BFLProgressCallback
    ): Promise<BFLGenerationResult> {
        if (!this.hasApiKey()) {
            throw new AuthenticationError('BFL API Key 未配置');
        }

        // BFL Fill API 字段名是 "image"（不是 "input_image"，后者用于 Kontext）
        const payload: Record<string, unknown> = {
            prompt,
            image: inputImage,
            mask: maskImage,
        };

        if (options.width) payload.width = options.width;
        if (options.height) payload.height = options.height;
        if (options.seed !== undefined) payload.seed = options.seed;
        if (options.outputFormat) payload.output_format = options.outputFormat;
        if (options.steps !== undefined) payload.steps = options.steps;
        if (options.guidance !== undefined) payload.guidance = options.guidance;
        if (options.safetyTolerance !== undefined) payload.safety_tolerance = options.safetyTolerance;
        if (options.promptUpsampling !== undefined) payload.prompt_upsampling = options.promptUpsampling;
        if (options.webhookUrl) payload.webhook_url = options.webhookUrl;
        if (options.webhookSecret) payload.webhook_secret = options.webhookSecret;

        await this.semaphore.acquire();
        try {
            return await this.submitAndPoll('flux-pro-1.0-fill', payload, options.timeout ?? this.timeout, onProgress);
        } finally {
            this.semaphore.release();
        }
    }

    /**
     * 批量生成
     */
    async generateBatch(
        model: BFLModelType,
        prompts: string[],
        options: BFLGenerateOptions = {}
    ): Promise<Array<BFLGenerationResult | Error>> {
        const tasks = prompts.map((prompt) =>
            this.generateText2Image(model, prompt, options).catch((e) => e)
        );
        return Promise.all(tasks);
    }

    /**
     * 下载生成的图像
     */
    async downloadImage(url: string): Promise<Buffer> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new BFLError(`下载失败: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    /**
     * 测试 API Key 有效性
     */
    async testApiKey(apiKey?: string): Promise<{ success: boolean; message?: string; error?: string }> {
        const keyToTest = apiKey || this.apiKey;
        if (!keyToTest || keyToTest.length < 10) {
            return { success: false, error: 'API Key 格式不正确' };
        }

        try {
            // 发送一个最小的请求来测试 API Key
            // 使用 GET 请求获取账户信息（如果可用）
            const response = await fetch(`${this.baseUrl}/v1/me`, {
                method: 'GET',
                headers: {
                    'x-key': keyToTest,
                    'Content-Type': 'application/json',
                },
            });

            if (response.ok) {
                const data = await response.json();
                return { 
                    success: true, 
                    message: `✅ API Key 有效${data.credits ? ` (余额: ${data.credits} credits)` : ''}`
                };
            } else if (response.status === 401) {
                return { success: false, error: '❌ API Key 无效或已过期' };
            } else if (response.status === 404) {
                // 某些端点可能不存在，但 API Key 格式正确
                return { success: true, message: '✅ API Key 格式有效（将在使用时验证）' };
            } else {
                return { success: false, error: `❌ API 错误: ${response.status}` };
            }
        } catch (err: any) {
            // 网络错误，但 API Key 格式正确
            if (keyToTest.length >= 30) {
                return { success: true, message: '✅ API Key 格式有效（网络暂时不可用）' };
            }
            return { success: false, error: `❌ 验证失败: ${err.message}` };
        }
    }

    // --- Private Methods ---

    private async submitAndPoll(
        model: string,
        payload: Record<string, unknown>,
        timeout: number,
        onProgress?: BFLProgressCallback
    ): Promise<BFLGenerationResult> {
        const endpoint = `${this.baseUrl}/v1/${model}`;
        const startTime = Date.now();

        console.log(`[BFLService] 提交请求到 ${model}...`);

        // 提交请求
        const submitResponse = await this.requestWithRetry('POST', endpoint, payload);

        const pollingUrl = submitResponse.polling_url as string;
        const generationId = (submitResponse.id as string) ?? pollingUrl.split('=').pop() ?? 'unknown';

        console.log(`[BFLService] 任务已提交, ID: ${generationId}`);
        onProgress?.({
            phase: 'submitted',
            model,
            generationId,
            elapsedMs: Date.now() - startTime
        });

        // 轮询结果
        const result = await this.poll(pollingUrl, timeout, model, generationId, startTime, onProgress);
        const elapsedMs = Date.now() - startTime;

        console.log(`[BFLService] 生成完成!`);
        onProgress?.({
            phase: 'ready',
            model,
            generationId,
            pollingCount: result.pollingCount,
            elapsedMs
        });

        return {
            id: generationId,
            url: result.data.sample as string,
            width: (result.data.width as number) ?? (payload.width as number),
            height: (result.data.height as number) ?? (payload.height as number),
            pollingCount: result.pollingCount,
            elapsedMs,
            raw: result.data,
        };
    }

    private async poll(
        pollingUrl: string,
        timeout: number,
        model: string,
        generationId: string,
        startTime: number,
        onProgress?: BFLProgressCallback
    ): Promise<{ data: Record<string, unknown>; pollingCount: number }> {
        let delay = 1000;
        let pollingCount = 0;

        while (Date.now() - startTime < timeout) {
            const response = await this.requestWithRetry('GET', pollingUrl);
            pollingCount += 1;

            const status = response.status as string;
            const progress = this.extractProgressPercent(response);
            onProgress?.({
                phase: 'polling',
                model,
                generationId,
                pollingCount,
                elapsedMs: Date.now() - startTime,
                status,
                progress
            });
            if (status === 'Ready') {
                return {
                    data: (response.result as Record<string, unknown>) ?? response,
                    pollingCount
                };
            } else if (status === 'Error') {
                throw new GenerationError((response.error as string) ?? '生成失败');
            }

            // 指数退避（最大 5 秒）
            await this.sleep(delay);
            delay = Math.min(delay * 1.5, 5000);
        }

        throw new Error(`生成超时 (${timeout}ms)`);
    }

    private extractProgressPercent(response: Record<string, unknown>): number | undefined {
        const raw = response.progress;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            return undefined;
        }

        if (raw >= 0 && raw <= 1) {
            return Math.max(0, Math.min(100, raw * 100));
        }

        if (raw >= 0 && raw <= 100) {
            return raw;
        }

        return undefined;
    }

    private async requestWithRetry(
        method: string,
        url: string,
        body?: Record<string, unknown>,
        maxRetries: number = 3
    ): Promise<Record<string, unknown>> {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method,
                    headers: this.getHeaders(),
                    body: body ? JSON.stringify(body) : undefined,
                });

                return await this.handleResponse(response);
            } catch (e) {
                if (e instanceof RateLimitError) {
                    console.warn(`[BFLService] 速率限制, 等待 ${e.retryAfter}s`);
                    await this.sleep(e.retryAfter * 1000 * (attempt + 1));
                    lastError = e;
                } else if (e instanceof BFLError && e.statusCode && e.statusCode >= 500) {
                    const waitTime = Math.pow(2, attempt) * 1000;
                    console.warn(`[BFLService] 服务器错误, ${waitTime}ms 后重试`);
                    await this.sleep(waitTime);
                    lastError = e;
                } else {
                    throw e;
                }
            }
        }

        throw lastError ?? new Error('超过最大重试次数');
    }

    private async handleResponse(response: Response): Promise<Record<string, unknown>> {
        if (response.ok) {
            return response.json();
        }

        let errorData: Record<string, unknown>;
        let rawText = '';
        try {
            rawText = await response.text();
            errorData = JSON.parse(rawText);
        } catch {
            errorData = { message: rawText || `HTTP ${response.status}` };
        }

        // BFL 返回的 detail 可能是字符串、对象或数组，统一序列化
        let message: string;
        const detail = errorData.detail;
        if (typeof detail === 'string') {
            message = detail;
        } else if (detail && typeof detail === 'object') {
            message = JSON.stringify(detail);
        } else {
            message = (errorData.message as string)
                ?? (errorData.error as string)
                ?? rawText
                ?? `BFL HTTP ${response.status}`;
        }
        console.error(`[BFLService] API 错误 ${response.status}: ${message}`, JSON.stringify(errorData));

        switch (response.status) {
            case 401:
                throw new AuthenticationError(message);
            case 402:
                throw new InsufficientCreditsError(message);
            case 429:
                const retryAfter = parseInt(response.headers.get('Retry-After') ?? '5', 10);
                throw new RateLimitError(message, retryAfter);
            case 400:
                throw new ValidationError(message);
            default:
                throw new BFLError(message, response.status);
        }
    }

    private validateDimensions(width: number, height: number): void {
        if (width % 16 !== 0) {
            throw new ValidationError(`宽度 ${width} 必须是 16 的倍数`);
        }
        if (height % 16 !== 0) {
            throw new ValidationError(`高度 ${height} 必须是 16 的倍数`);
        }
        if (width * height > 4_000_000) {
            throw new ValidationError(`总像素 (${width}x${height}) 超过 4MP 限制`);
        }
        if (width < 64 || height < 64) {
            throw new ValidationError('最小尺寸为 64 像素');
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

// 导出单例
export const bflService = new BFLService();
