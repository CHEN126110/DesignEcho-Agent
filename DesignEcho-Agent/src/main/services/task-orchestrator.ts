/**
 * 任务调度器
 * 
 * 根据任务类型和用户偏好选择最合适的 AI 模型
 */

import { ModelService, ModelMessage } from './model-service';
import { TASK_ROUTING, TaskType } from '../../shared/types/tasks';
import { PROMPTS } from '../../shared/prompts';
import { getModelById } from '../../shared/config/models.config';
import {
    getAgentWorkerModels,
    getModelPriorityForPreferenceBucket,
    getPrimaryModelForPreferenceBucket,
    type ModelPreferenceBucket
} from '../../shared/model-selection';
import {
    DEFAULT_MODEL_PREFERENCES,
    normalizeModelPreferences,
    type ModelPreferences as SharedModelPreferences,
    type ModelPreferencesPatch
} from '../../shared/config/models.config';

// 模型模式
export type ModelMode = 'local' | 'cloud' | 'auto';

// 任务模型配置
export interface TaskModelConfig {
    layoutAnalysis: string;
    textOptimize: string;
    visualAnalyze: string;
}

// 模型偏好设置从统一模型配置导入；本文件只负责调度，不重新定义偏好结构。
export type ModelPreferences = SharedModelPreferences;

export interface TaskExecutionOptions {
    constraintProfile?: {
        platform?: string;
        brandTone?: string;
        styleKeywords?: string[];
        hardConstraints?: Record<string, unknown>;
        softConstraints?: Record<string, unknown>;
    };
    decisionContext?: {
        stage?: 'diagnosis' | 'decision' | 'execution' | string;
        goal?: string;
    };
    expectedOutputSchema?: Record<string, unknown>;
}

export interface TaskStreamCallbacks {
    onStart?: (meta: { taskType: TaskType; modelId: string }) => void;
    onContent?: (content: string) => void;
    onThinking?: (thinking: string) => void;
    onDone?: (response: { text: string; thinking?: string }) => void;
    onError?: (error: string) => void;
}

// 任务类型到配置键的映射
const TASK_CONFIG_MAP: Record<string, keyof TaskModelConfig> = {
    'layout-analysis': 'layoutAnalysis',
    'layout-fix': 'layoutAnalysis',
    'text-optimize': 'textOptimize',
    'reference-analyze': 'visualAnalyze',
    'visual-compare': 'visualAnalyze',
};

// 默认偏好
const DEFAULT_PREFERENCES: ModelPreferences = normalizeModelPreferences(DEFAULT_MODEL_PREFERENCES);

export class TaskOrchestrator {
    private modelService: ModelService;
    private preferences: ModelPreferences = DEFAULT_PREFERENCES;

    constructor(modelService: ModelService) {
        this.modelService = modelService;
    }

    /**
     * 更新模型偏好设置
     */
    updatePreferences(prefs: ModelPreferencesPatch): void {
        this.preferences = normalizeModelPreferences({
            ...this.preferences,
            ...prefs,
            thinking: {
                ...this.preferences.thinking,
                ...prefs.thinking
            }
        });
        console.log('[TaskOrchestrator] Preferences updated:', this.preferences.mode);
    }

    /**
     * 获取当前偏好设置
     */
    getPreferences(): ModelPreferences {
        return this.preferences;
    }

    /** 获取主 Agent / 视觉专家模型；copy 与 logic 都指向主模型，vision 指向独立视觉模型。 */
    getAgentModels(): { vision: string; copy: string; logic: string } {
        return getAgentWorkerModels(this.preferences, {
            mode: this.preferences.mode,
            includeFallback: this.preferences.autoFallback
        });
    }

    /**
     * 根据任务类型和偏好获取模型
     */
    private getModelForTask(taskType: TaskType): { primary: string } {
        const candidates = this.getModelCandidatesForTask(taskType);
        return { primary: candidates[0] || 'local-qwen2.5-7b' };
    }

    private getModelCandidatesForTask(taskType: TaskType): string[] {
        const configKey = TASK_CONFIG_MAP[taskType] as ModelPreferenceBucket | undefined;
        const apiKeys = typeof (this.modelService as any).getModelSelectionApiKeys === 'function'
            ? (this.modelService as any).getModelSelectionApiKeys()
            : undefined;

        // Unknown task type falls back to static routing config.
        if (!configKey) {
            const routing = TASK_ROUTING.find(r => r.taskType === taskType);
            return [routing?.primaryModel || 'local-qwen2.5-7b'];
        }

        const primary = getPrimaryModelForPreferenceBucket(this.preferences, configKey, {
            mode: this.preferences.mode,
            includeFallback: this.preferences.autoFallback,
            includeCrossTaskBackups: false,
            requireVision: configKey === 'visualAnalyze'
        });
        const recovery = getModelPriorityForPreferenceBucket(this.preferences, configKey, {
            mode: this.preferences.mode,
            includeFallback: true,
            includeCrossTaskBackups: true,
            includeConfiguredProviderBackups: true,
            apiKeys,
            requireVision: configKey === 'visualAnalyze'
        });

        return Array.from(new Set([primary, ...recovery].filter(Boolean)));
    }

    private buildFallbackState(input: {
        stage: string;
        reasonCode: string;
        primaryModel: string;
        fallbackModel?: string | null;
        attempts: Array<{ modelId: string; error?: string }>;
        streamed?: boolean;
    }): Record<string, unknown> {
        return {
            stage: input.stage,
            reasonCode: input.reasonCode,
            primaryModel: input.primaryModel,
            fallbackModel: input.fallbackModel || null,
            attempts: input.attempts,
            streamed: input.streamed === true
        };
    }

    private async executeWithModelCandidate(
        taskType: TaskType,
        input: any,
        options: TaskExecutionOptions | undefined,
        modelId: string,
        attempts: Array<{ modelId: string; error?: string }>,
        primary: string
    ): Promise<any> {
        console.log(`[TaskOrchestrator] Executing ${taskType} with ${modelId} (mode: ${this.preferences.mode})`);
        const messages = this.buildMessages(taskType, input, options, modelId);
        const response = await this.modelService.chat(
            modelId,
            messages,
            { maxTokens: 4096, temperature: 0.7 }
        );
        return this.attachExecutionState(
            this.parseResponse(taskType, response.text),
            this.buildFallbackState({
                stage: modelId === primary ? 'primary_success' : 'fallback_success',
                reasonCode: modelId === primary ? 'PRIMARY_OK' : 'FALLBACK_OK',
                primaryModel: primary,
                fallbackModel: modelId === primary ? null : modelId,
                attempts
            })
        );
    }

    private streamWithModelCandidate(
        taskType: TaskType,
        input: any,
        callbacks: TaskStreamCallbacks,
        options: TaskExecutionOptions | undefined,
        modelId: string,
        attempts: Array<{ modelId: string; error?: string }>,
        primary: string
    ): Promise<any> {
        console.log(`[TaskOrchestrator] Streaming ${taskType} with ${modelId} (mode: ${this.preferences.mode})`);
        const messages = this.buildMessages(taskType, input, options, modelId);
        callbacks.onStart?.({ taskType, modelId });

        const adapter = this.modelService.chatStream(
            modelId,
            messages,
            { maxTokens: 4096, temperature: 0.7 }
        );

        return new Promise((resolve, reject) => {
            let fullContent = '';
            let fullThinking = '';
            let settled = false;

            adapter.on('chunk', (chunk: any) => {
                if (!chunk || settled) return;

                if (chunk.type === 'content') {
                    const content = String(chunk.content || '');
                    fullContent += content;
                    callbacks.onContent?.(content);
                    return;
                }

                if (chunk.type === 'thinking') {
                    const thinking = String(chunk.thinking || '');
                    fullThinking += thinking;
                    callbacks.onThinking?.(thinking);
                    return;
                }

                if (chunk.type === 'done') {
                    settled = true;
                    const text = String(chunk.fullResponse?.text ?? fullContent);
                    const thinking = String(chunk.fullResponse?.thinking || fullThinking || '');
                    callbacks.onDone?.({ text, thinking: thinking || undefined });
                    resolve(this.attachExecutionState(
                        this.parseResponse(taskType, text),
                        this.buildFallbackState({
                            stage: modelId === primary ? 'primary_success' : 'fallback_success',
                            reasonCode: modelId === primary ? 'PRIMARY_OK' : 'FALLBACK_OK',
                            primaryModel: primary,
                            fallbackModel: modelId === primary ? null : modelId,
                            attempts,
                            streamed: true
                        })
                    ));
                    return;
                }

                if (chunk.type === 'error') {
                    settled = true;
                    const message = String(chunk.error || '模型流式请求失败');
                    callbacks.onError?.(message);
                    reject(new Error(message));
                }
            });
        });
    }

    private buildAllModelsFailedError(input: {
        taskType: TaskType;
        primary: string;
        attempts: Array<{ modelId: string; error?: string }>;
        streamed?: boolean;
    }): Error {
        const summary = input.attempts
            .map((attempt) => `${attempt.modelId}: ${attempt.error || 'failed'}`)
            .slice(0, 4)
            .join(' | ');
        const error = new Error(summary || `${input.taskType} model execution failed`);
        (error as any).fallbackState = this.buildFallbackState({
            stage: 'all_candidates_failed',
            reasonCode: 'ALL_MODEL_CANDIDATES_FAILED',
            primaryModel: input.primary,
            fallbackModel: null,
            attempts: input.attempts,
            streamed: input.streamed
        });
        return error;
    }

    private getPrimaryModelOrFallback(taskType: TaskType): string {
        const candidates = this.getModelCandidatesForTask(taskType);
        return candidates[0] || 'local-qwen2.5-7b';
    }

    /**
     * 保留给外部兼容：返回当前首选模型，不代表执行时只会尝试这一个模型。
     */
    private getPrimaryModelForLog(taskType: TaskType): string {
        const configKey = TASK_CONFIG_MAP[taskType] as ModelPreferenceBucket | undefined;
        if (!configKey) return this.getPrimaryModelOrFallback(taskType);
        return getPrimaryModelForPreferenceBucket(this.preferences, configKey, {
            mode: this.preferences.mode,
            includeFallback: this.preferences.autoFallback,
            includeCrossTaskBackups: false,
            requireVision: configKey === 'visualAnalyze'
        }) || this.getPrimaryModelOrFallback(taskType);
    }

    /**
     * 执行任务
     */
    async execute(taskType: TaskType, input: any, options?: TaskExecutionOptions): Promise<any> {
        const candidates = this.getModelCandidatesForTask(taskType);
        const primary = candidates[0] || this.getPrimaryModelForLog(taskType);
        const attempts: Array<{ modelId: string; error?: string }> = [];

        for (const modelId of candidates) {
            try {
                return await this.executeWithModelCandidate(taskType, input, options, modelId, attempts, primary);
            } catch (error: any) {
                const message = error?.message || String(error);
                attempts.push({ modelId, error: message });
                console.error(`[TaskOrchestrator] Model ${modelId} error:`, message);
            }
        }

        throw this.buildAllModelsFailedError({ taskType, primary, attempts });
    }

    async executeStream(
        taskType: TaskType,
        input: any,
        callbacks: TaskStreamCallbacks = {},
        options?: TaskExecutionOptions
    ): Promise<any> {
        const candidates = this.getModelCandidatesForTask(taskType);
        const primary = candidates[0] || this.getPrimaryModelForLog(taskType);
        const attempts: Array<{ modelId: string; error?: string }> = [];

        for (const modelId of candidates) {
            try {
                return await this.streamWithModelCandidate(taskType, input, callbacks, options, modelId, attempts, primary);
            } catch (error: any) {
                const message = error?.message || String(error);
                attempts.push({ modelId, error: message });
                console.error(`[TaskOrchestrator] Stream model ${modelId} error:`, message);
            }
        }

        throw this.buildAllModelsFailedError({ taskType, primary, attempts, streamed: true });
    }

    private attachExecutionState(result: any, state: Record<string, unknown>): any {
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            return {
                ...result,
                executionState: state
            };
        }
        return {
            data: result,
            executionState: state
        };
    }

    /**
     * 构建消息
     *
     * systemPromptOverride：调用方自带完整指令时替换默认任务提示词，
     * 避免两套指令叠加互相矛盾（默认提示词与调用方提示词的输出格式约定不同）。
     */
    private buildMessages(taskType: TaskType, input: any, options?: TaskExecutionOptions, modelId?: string): ModelMessage[] {
        const override = typeof input.systemPromptOverride === 'string' ? input.systemPromptOverride.trim() : '';
        const systemPrompt = override || PROMPTS[taskType];

        // 视觉能力以模型注册表为准：不支持视觉的模型不发图，并显式声明图片不可见，
        // 防止提示词声称"已附带图片"而模型实际看不到时臆造画面内容。
        const model = modelId ? getModelById(modelId) : undefined;
        const modelCanSeeImages = model?.supportsVision === true;
        const hasImageInput = Boolean(input.image || input.documentImage);

        // 构建用户消息
        const userContent: any[] = [];

        // 添加系统提示
        userContent.push({
            type: 'text',
            text: systemPrompt
        });

        // 添加输入数据
        if (hasImageInput && !modelCanSeeImages) {
            userContent.push({
                type: 'text',
                text: '\n\n[视觉输入不可用] 当前执行模型无法读取图片，上文提到的参考图片或画布截图实际不可见。禁止臆造画面内容；只依据文字提供的事实作答，与画面强绑定的表达必须省略或改为克制的中性表达。'
            });
        }

        if (input.image && modelCanSeeImages) {
            userContent.push({
                type: 'text',
                text: '\n\n[参考设计图]'
            });
            userContent.push({
                type: 'image',
                image: {
                    data: input.image.data,
                    mediaType: input.image.mediaType || 'image/png'
                }
            });
        }

        if (input.documentImage && modelCanSeeImages) {
            userContent.push({
                type: 'text',
                text: '\n\n[当前画布截图]'
            });
            userContent.push({
                type: 'image',
                image: {
                    data: input.documentImage.data,
                    mediaType: input.documentImage.mediaType || 'image/png'
                }
            });
        }

        if (input.text) {
            userContent.push({
                type: 'text',
                text: `\n\n用户输入：\n${input.text}`
            });
        }

        if (input.layers) {
            userContent.push({
                type: 'text',
                text: `\n\n图层信息：\n${JSON.stringify(input.layers, null, 2)}`
            });
        }

        if (input.documentInfo) {
            userContent.push({
                type: 'text',
                text: `\n\n文档信息：\n${JSON.stringify(input.documentInfo, null, 2)}`
            });
        }

        if (options?.constraintProfile) {
            userContent.push({
                type: 'text',
                text: `\n\n设计约束（必须遵守）：\n${JSON.stringify(options.constraintProfile, null, 2)}`
            });
        }

        if (options?.decisionContext) {
            userContent.push({
                type: 'text',
                text: `\n\n当前阶段：${JSON.stringify(options.decisionContext, null, 2)}`
            });
        }

        if (options?.expectedOutputSchema) {
            userContent.push({
                type: 'text',
                text: `\n\n输出必须为 JSON，遵守以下 schema：\n${JSON.stringify(options.expectedOutputSchema, null, 2)}`
            });
        }

        return [{
            role: 'user',
            content: userContent
        }];
    }

    /**
     * 解析响应
     */
    private parseResponse(taskType: TaskType, responseText: string): any {
        // 尝试提取 JSON
        const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1]);
            } catch (e) {
                console.warn('[TaskOrchestrator] Failed to parse JSON from response');
            }
        }

        // 尝试直接解析
        try {
            return JSON.parse(responseText);
        } catch (e) {
            // 返回原始文本
            return { text: responseText };
        }
    }
}
