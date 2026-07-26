/**
 * 模型服务
 * 
 * 统一管理多个 AI 模型的调用
 * 
 * v2.0 更新：
 * - 统一思维过程提取（ThinkingExtractor）
 * - 支持不同模型的思维过程格式
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import http from 'http';
import { EventEmitter } from 'events';
import { ALL_MODELS, ModelConfig, getModelById, ThinkingConfig } from '../../shared/config/models.config';
import { buildAgentProviderTokenBudget } from '../../shared/agent-performance-policy';
import type {
    AgentToolStreamChunk,
    AgentToolStreamResponse,
    AgentToolStreamToolCall
} from '../../shared/agent-tool-stream';
import { extractThinking, extractThinkingFromModel, getThinkingRequestParams } from './thinking-extractor';
import { getProviderAdapter } from './provider-adapters';
import type { ToolSchema, AdapterMessage, ProviderResponse } from './provider-adapters';
import { configureProcessProxyFromSystem, getOpenAIHttpAgent } from './network-proxy';
import type { ProviderNativeToolRequest, ProviderNativeToolCitation } from '../../shared/provider-native-tools';
import {
    buildProviderNativeToolPlan,
    normalizeProviderNativeToolCitations
} from '../../shared/provider-native-tools';
import { normalizeStreamTextChunk } from '../../shared/stream-text-normalizer';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_TEST_MODEL = 'deepseek-v4-pro';
const OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS = 45_000;
const OPENAI_COMPATIBLE_MIN_TIMEOUT_MS = 5_000;
const OPENAI_COMPATIBLE_MAX_TIMEOUT_MS = 120_000;
const XIAOMI_MIMO_DEFAULT_TEMPERATURE = 1.0;
const XIAOMI_MIMO_DEFAULT_TOP_P = 0.95;

interface ModelChatOptions {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    thinkingEnabled?: boolean;
}

function resolveOpenAICompatibleTimeoutMs(options?: ModelChatOptions): number {
    const requested = Number(options?.timeoutMs);
    if (Number.isFinite(requested) && requested > 0) {
        return Math.min(
            OPENAI_COMPATIBLE_MAX_TIMEOUT_MS,
            Math.max(OPENAI_COMPATIBLE_MIN_TIMEOUT_MS, Math.floor(requested))
        );
    }
    return OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS;
}

function resolveChatMaxTokens(
    options?: { maxTokens?: number },
    legacyDefaultMaxTokens?: number
): number {
    return buildAgentProviderTokenBudget({
        requestedMaxTokens: options?.maxTokens,
        legacyDefaultMaxTokens
    }).maxTokens;
}

export interface ModelMessage {
    role: 'user' | 'assistant';
    content: string | MessageContent[];
}

export interface MessageContent {
    type: 'text' | 'image';
    text?: string;
    image?: {
        data: string;      // base64
        mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    };
}

export interface ModelResponse {
    text: string;
    thinking?: string;  // 模型的思维过程（如果有）
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

export interface AgentToolStreamHandle extends EventEmitter {
    abort: () => void;
}

interface AccumulatedToolCall {
    id?: string;
    name?: string;
    argumentsText: string;
}

function normalizeProviderStreamStopReason(
    providerFinishReason: string | undefined,
    hasToolCalls: boolean
): string {
    if (providerFinishReason === 'length') return 'max_tokens';
    if (providerFinishReason === 'tool_calls') return 'tool_use';
    if (providerFinishReason === 'stop') return 'end_turn';
    if (providerFinishReason) return providerFinishReason;
    return hasToolCalls ? 'tool_use' : 'end_turn';
}

function safeParseToolArguments(value: string): Record<string, any> {
    const trimmed = String(value || '').trim();
    if (!trimmed) return {};
    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function buildToolCallsFromDeltas(calls: Map<number, AccumulatedToolCall>): AgentToolStreamToolCall[] {
    return [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, call]) => ({
            id: call.id || `stream_call_${index}`,
            name: call.name || '',
            arguments: safeParseToolArguments(call.argumentsText)
        }))
        .filter((call) => call.name);
}

export interface DeepSeekTestResult {
    success: boolean;
    message?: string;
    error?: string;
    status?: number;
    baseUrl?: string;
    model?: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

interface ModelServiceConfig {
    anthropicApiKey?: string;
    googleApiKey?: string;
    xiaomiApiKey?: string;
    openaiApiKey?: string;
    gptsapiApiKey?: string;
    openrouterApiKey?: string;
    deepseekApiKey?: string;
    ollamaUrl?: string;
    ollamaApiKey?: string;  // Ollama Cloud API Key
    bflApiKey?: string;     // Black Forest Labs (FLUX) API Key
}

interface ModelToolCallOptions {
    maxTokens?: number;
    temperature?: number;
    nativeTools?: ProviderNativeToolRequest[];
    /** per-request 超时(毫秒)，覆盖 client 默认 45 秒。web_search 等联网慢调用需要更长。 */
    timeoutMs?: number;
    /** 工具循环是否开启原生思考(reasoning_content)；透传给 adapter.formatMessages 决定思考开关与 reasoning 回写。 */
    thinkingEnabled?: boolean;
}

export class ModelService {
    private anthropic: Anthropic | null = null;
    private gemini: GoogleGenerativeAI | null = null;
    private xiaomi: OpenAI | null = null;
    private openai: OpenAI | null = null;
    private gptsapi: OpenAI | null = null;
    private deepseek: OpenAI | null = null;
    private ollamaBaseUrl = 'http://127.0.0.1:11434';
    private config: ModelServiceConfig;

    constructor(config: ModelServiceConfig) {
        this.config = config;
        this.initializeClients();
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<ModelServiceConfig>): void {
        this.config = { ...this.config, ...config };
        this.initializeClients();
    }

    getModelSelectionApiKeys(): Record<string, string | undefined> {
        return {
            anthropic: this.config.anthropicApiKey,
            google: this.config.googleApiKey,
            xiaomi: this.config.xiaomiApiKey,
            openai: this.config.openaiApiKey,
            gptsapi: this.config.gptsapiApiKey,
            openrouter: this.config.openrouterApiKey,
            deepseek: this.config.deepseekApiKey,
            ollamaApiKey: this.config.ollamaApiKey,
            bfl: this.config.bflApiKey
        };
    }

    /**
     * 初始化客户端
     */
    private initializeClients(): void {
        configureProcessProxyFromSystem();
        const httpAgent = getOpenAIHttpAgent();

        this.anthropic = null;
        this.gemini = null;
        this.xiaomi = null;
        this.openai = null;
        this.gptsapi = null;
        this.deepseek = null;

        if (this.config.anthropicApiKey) {
            this.anthropic = new Anthropic({ apiKey: this.config.anthropicApiKey });
            console.log('[ModelService] Anthropic client initialized');
        }
        if (this.config.googleApiKey) {
            this.gemini = new GoogleGenerativeAI(this.config.googleApiKey);
            console.log('[ModelService] Gemini client initialized');
        }
        if (this.config.xiaomiApiKey) {
            this.xiaomi = new OpenAI({
                apiKey: this.config.xiaomiApiKey,
                baseURL: 'https://api.xiaomimimo.com/v1',
                httpAgent,
                timeout: OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS,
                maxRetries: 0
            });
            console.log('[ModelService] Xiaomi MiMo client initialized');
        }
        if (this.config.openaiApiKey) {
            this.openai = new OpenAI({
                apiKey: this.config.openaiApiKey,
                httpAgent,
                timeout: OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS,
                maxRetries: 0
            });
            console.log('[ModelService] OpenAI client initialized');
        }
        if (this.config.gptsapiApiKey) {
            this.gptsapi = new OpenAI({
                apiKey: this.config.gptsapiApiKey,
                baseURL: 'https://api.gptsapi.net/v1',
                httpAgent,
                timeout: OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS,
                maxRetries: 0
            });
            console.log('[ModelService] GPTs API client initialized');
        }
        if (this.config.deepseekApiKey) {
            this.deepseek = new OpenAI({
                apiKey: this.config.deepseekApiKey,
                baseURL: DEEPSEEK_BASE_URL,
                httpAgent,
                timeout: OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS,
                maxRetries: 0
            });
            console.log('[ModelService] DeepSeek official client initialized');
        }
        if (this.config.ollamaUrl) {
            this.ollamaBaseUrl = this.config.ollamaUrl;
        }
    }

    /**
     * 统一聊天接口
     * 
     * 模型 ID 格式：
     * - 本地模型: local-xxx (如 local-qwen2.5-14b)
     * - 云端模型: provider-xxx (如 google-gemini-3-pro)
     */
    async chat(
        modelId: string,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        console.log(`[ModelService] ========== chat() 被调用 ==========`);
        console.log(`[ModelService] modelId: ${modelId}`);
        console.log(`[ModelService] 消息数量: ${messages.length}`);
        
        // 从统一配置获取模型信息
        const model = getModelById(modelId);
        
        // 如果找不到，尝试动态解析模型 ID
        if (!model) {
            // 本地 Ollama 模型（新格式）
            if (modelId.startsWith('local-')) {
                const ollamaModel = this.localIdToOllamaModel(modelId);
                console.log(`[ModelService] Dynamic local Ollama model: ${ollamaModel}`);
                return this.chatOllamaDynamic(ollamaModel, messages, options);
            }
            // 兼容旧的 ollama- 前缀
            if (modelId.startsWith('ollama-') && !modelId.startsWith('ollama-cloud-')) {
                const ollamaModel = modelId.replace('ollama-', '');
                console.log(`[ModelService] Legacy Ollama model: ${ollamaModel}`);
                return this.chatOllamaDynamic(ollamaModel, messages, options);
            }
            // 动态 OpenRouter 模型
            if (modelId.startsWith('openrouter-')) {
                const orModel = modelId.replace('openrouter-', '');
                console.log(`[ModelService] Dynamic OpenRouter model: ${orModel}`);
                return this.chatOpenRouterDynamic(orModel, messages, options);
            }
            // 注册表也查不到（动态模型未注入主进程）：内部 id 经 slug 化不可逆，
            // 不能从字符串反推真实 apiModelId。如实提示用户重新刷新该 provider 的模型列表。
            throw new Error(
                `动态模型未注册（${modelId}），无法解析真实 API 模型名。请在设置中重新刷新该 provider 的模型列表后重试。`
            );
        }

        console.log(`[ModelService] 调用模型: ${model.name} (${model.source}/${model.provider})`);

        switch (model.provider) {
            case 'ollama':
                // 本地 Ollama
                return this.chatOllama(model as any, messages, options);
            case 'ollama-cloud':
                // Ollama Cloud 云服务
                return this.chatOllamaCloud(model as any, messages, options);
            case 'google':
                return this.chatGemini(model as any, messages, options);
            case 'xiaomi':
                return this.chatXiaomi(model as any, messages, options);
            case 'openrouter':
                return this.chatOpenRouter(model as any, messages, options);
            case 'anthropic':
                return this.chatAnthropic(model as any, messages, options);
            case 'openai':
                return this.chatOpenAI(model as any, messages, options);
            case 'gptsapi':
                return this.chatGPTsAPI(model as any, messages, options);
            case 'deepseek':
                return this.chatDeepSeek(model as any, messages, options);
            default:
                throw new Error(`不支持的提供商: ${model.provider}`);
        }
    }
    
    /**
     * 将 local-xxx 格式的 ID 转换为 Ollama 模型名
     */
    private localIdToOllamaModel(localId: string): string {
        // local-qwen2.5-14b -> qwen2.5:14b
        const name = localId.replace('local-', '');
        // 查找最后一个 - 后面的数字部分作为标签
        const match = name.match(/^(.+)-(\d+b)$/);
        if (match) {
            return `${match[1]}:${match[2]}`;
        }
        return name;
    }

    /**
     * 动态 Ollama 模型调用（支持用户自定义模型）
     * 
     * 使用统一的 ThinkingExtractor（默认尝试 xml_tag）
     */
    private async chatOllamaDynamic(
        ollamaModel: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        console.log(`[ModelService] Calling dynamic Ollama model: ${ollamaModel}`);

        const ollamaMessages = messages.map(msg => {
            const baseMessage: any = {
                role: msg.role,
                content: typeof msg.content === 'string'
                    ? msg.content
                    : msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
            };

            if (typeof msg.content !== 'string') {
                const images = msg.content
                    .filter(c => c.type === 'image' && c.image)
                    .map(c => c.image!.data);
                if (images.length > 0) {
                    baseMessage.images = images;
                }
            }

            return baseMessage;
        });

        const requestBody = JSON.stringify({
            model: ollamaModel,
            messages: ollamaMessages,
            stream: false,
            options: {
                num_predict: resolveChatMaxTokens(options),
                temperature: options?.temperature ?? 0.7
            }
        });

        return new Promise((resolve, reject) => {
            const http = require('http');
            const req = http.request({
                hostname: '127.0.0.1',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 180000  // 3 分钟，大模型冷启动需更长时间
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`Ollama error (${res.statusCode}): ${data}`));
                            return;
                        }
                        const parsed = JSON.parse(data);
                        
                        // 动态模型默认尝试 xml_tag 格式
                        const { thinking, content } = extractThinkingFromModel(parsed, undefined);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.prompt_eval_count || 0,
                                outputTokens: parsed.eval_count || 0
                            }
                        });
                    } catch (e) {
                        reject(new Error(`Failed to parse Ollama response: ${e}`));
                    }
                });
            });
            req.on('error', (error: any) => {
                reject(new Error(`🖥️ 无法连接到本地 Ollama 服务\n\n请检查:\n• 运行 ollama serve 启动服务\n• 或在设置中切换到云端模式`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ Ollama 响应超时 (3 分钟)\n\n可能原因:\n• 大模型首次加载需 1–2 分钟，请稍后重试\n• 可先运行 ollama run <模型名> 预热\n• 或切换到更小的模型`));
            });
            req.write(requestBody);
            req.end();
        });
    }

    /**
     * 动态 OpenRouter 模型调用
     * 
     * 使用统一的 ThinkingExtractor（默认尝试 reasoning_content + xml_tag）
     */
    private async chatOpenRouterDynamic(
        openrouterModel: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.config.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        console.log(`[ModelService] Calling dynamic OpenRouter model: ${openrouterModel}`);

        const openrouterMessages = messages.map(msg => ({
            role: msg.role,
            content: this.convertToOpenAIContent(msg.content)
        }));

        const requestBody = JSON.stringify({
            model: openrouterModel,
            messages: openrouterMessages,
            max_tokens: resolveChatMaxTokens(options),
            temperature: options?.temperature ?? 0.7
        });

        return new Promise((resolve, reject) => {
            const https = require('https');
            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 60000
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            let errorData: any = {};
                            try { errorData = JSON.parse(data); } catch {}
                            reject(new Error(this.formatOpenRouterError(res.statusCode, errorData, openrouterModel)));
                            return;
                        }
                        const parsed = JSON.parse(data);
                        
                        // 动态模型默认尝试 reasoning_content 格式
                        const dynamicThinkingConfig: ThinkingConfig = {
                            supported: true,
                            format: 'reasoning_content'
                        };
                        const { thinking, content } = extractThinkingFromModel(parsed, dynamicThinkingConfig);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.usage?.prompt_tokens || 0,
                                outputTokens: parsed.usage?.completion_tokens || 0
                            }
                        });
                    } catch (e) {
                        reject(new Error(`❌ OpenRouter 响应解析失败\n\n请稍后重试`));
                    }
                });
            });
            req.on('error', (error: any) => {
                reject(new Error(`🌐 无法连接到 OpenRouter\n\n请检查网络连接`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ OpenRouter 请求超时\n\n请稍后重试`));
            });
            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Claude API
     * 
     * 使用统一的 ThinkingExtractor 处理 Extended Thinking
     */
    private async chatAnthropic(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.anthropic) {
            throw new Error('Anthropic API key not configured');
        }

        const anthropicMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: this.convertToAnthropicContent(msg.content)
        }));

        const modelName = model.id === 'claude-3-5-sonnet' 
            ? 'claude-3-5-sonnet-20241022' 
            : model.id === 'claude-3-opus' 
                ? 'claude-3-opus-20240229'
                : model.id;

        const response = await this.anthropic.messages.create({
            model: modelName,
            max_tokens: resolveChatMaxTokens(options),
            temperature: options?.temperature,
            messages: anthropicMessages
        });

        // 使用统一的 ThinkingExtractor 提取思维过程
        const { thinking, content } = this.extractThinkingForResponse(response, model, options);
        
        return {
            text: content,
            thinking: thinking || undefined,
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens
            }
        };
    }

    /**
     * Gemini API (Google AI Studio 官方渠道)
     */
    private async chatGemini(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        console.log(`[ModelService] ========== Google AI 调用开始 ==========`);
        console.log(`[ModelService] Gemini 客户端状态: ${this.gemini ? '✅ 已初始化' : '❌ 未初始化'}`);
        console.log(`[ModelService] Google API Key 配置: ${this.config.googleApiKey ? '✅ 已配置 (' + this.config.googleApiKey.substring(0, 8) + '...)' : '❌ 未配置'}`);
        
        if (!this.gemini) {
            console.error('[ModelService] ❌ Gemini 客户端未初始化，API Key 可能未同步');
            throw new Error('Google API key not configured. 请在设置中配置 Google AI Studio API Key');
        }

        // 使用 apiModelId 获取正确的模型名称
        // Google AI SDK 接受两种格式: "gemini-1.5-pro" 或 "models/gemini-1.5-pro"
        let modelName = model.apiModelId || model.id.replace('google-', '');
        
        // 去除 models/ 前缀（SDK 会自动处理）
        if (modelName.startsWith('models/')) {
            modelName = modelName.replace('models/', '');
        }
        
        console.log(`[ModelService] 🎯 调用模型: ${modelName}`);
        console.log(`[ModelService] 📝 消息数量: ${messages.length}`);

        const genModel = this.gemini.getGenerativeModel({
            model: modelName,
            generationConfig: {
                maxOutputTokens: resolveChatMaxTokens(options, model.maxTokens || 8192),
                temperature: options?.temperature
            }
        });

        // 转换消息为 Gemini 格式
        const parts = this.convertToGeminiContent(messages);

        try {
        const result = await genModel.generateContent({
            contents: [{ role: 'user', parts }]
        });

        const response = await result.response;
            const rawText = response.text();
            
            // 使用统一的 ThinkingExtractor 提取思维过程
            // Google Gemini 不原生支持思维过程，但尝试解析 XML 标签
            const { thinking, content } = this.extractThinkingForResponse({ text: rawText }, model, options);
            
            console.log(`[ModelService] Google AI Studio response received (${content.length} chars)`);
            
        return {
                text: content,
                thinking: thinking || undefined,
            usage: {
                inputTokens: response.usageMetadata?.promptTokenCount || 0,
                outputTokens: response.usageMetadata?.candidatesTokenCount || 0
            }
        };
        } catch (error: any) {
            // 详细错误日志
            console.error(`[ModelService] ❌ Google AI 调用失败`);
            console.error(`[ModelService] 原始错误:`, error);
            console.error(`[ModelService] 错误类型: ${error.constructor?.name}`);
            console.error(`[ModelService] 错误消息: ${error.message}`);
            console.error(`[ModelService] 错误状态: ${error.status || error.statusCode || 'N/A'}`);
            
            // 提供更友好的错误信息
            const friendlyError = this.formatGoogleError(error, modelName);
            throw new Error(friendlyError);
        }
    }

    /**
     * 格式化 Google API 错误为友好提示
     */
    private formatGoogleError(error: any, modelName: string): string {
        const status = error.status || error.statusCode;
        const message = error.message || '';
        
        // 429 配额超限
        if (status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')) {
            // 尝试提取重试时间
            const retryMatch = message.match(/retry in (\d+)/i) || message.match(/retryDelay.*?(\d+)s/);
            const retryTime = retryMatch ? retryMatch[1] : null;
            
            let tip = `⚠️ Google AI 配额已用尽\n\n`;
            tip += `模型: ${modelName}\n`;
            if (retryTime) {
                tip += `建议等待: ${retryTime} 秒后重试\n\n`;
            }
            tip += `💡 解决方案:\n`;
            tip += `• 等待配额恢复（通常每分钟/每天重置）\n`;
            tip += `• 切换到其他模型（如 Gemini 2.5 Flash）\n`;
            tip += `• 升级 Google AI Studio 付费计划`;
            return tip;
        }
        
        // 401/403 认证错误
        if (status === 401 || status === 403 || message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED')) {
            return `🔑 Google AI API Key 无效或权限不足\n\n请检查:\n• API Key 是否正确\n• 是否已启用 Generative Language API\n• API Key 是否有使用限制`;
        }
        
        // 404 模型不存在
        if (status === 404 || message.includes('not found') || message.includes('NOT_FOUND')) {
            return `❌ 模型 ${modelName} 不存在\n\n可能原因:\n• 模型名称错误\n• 该模型在你的地区不可用\n• 模型已下线或更名`;
        }
        
        // 500 服务器错误
        if (status >= 500 || message.includes('INTERNAL')) {
            return `⚠️ Google AI 服务暂时不可用\n\n请稍后重试，或切换到其他模型`;
        }
        
        // 网络错误
        if (message.includes('fetch') || message.includes('network') || message.includes('ECONNREFUSED')) {
            return `🌐 网络连接失败\n\n请检查:\n• 网络连接是否正常\n• 是否需要代理访问 Google 服务`;
        }
        
        // 默认错误
        return `❌ Google AI 调用失败\n\n${message.substring(0, 200)}`;
    }

    /**
     * 格式化 OpenRouter API 错误为友好提示
     */
    private formatOpenRouterError(statusCode: number, errorData: any, modelName: string): string {
        const errorMessage = errorData?.error?.message || errorData?.message || '';
        
        // 401 认证错误
        if (statusCode === 401) {
            return `🔑 OpenRouter API Key 无效\n\n请在设置中检查 API Key 是否正确`;
        }
        
        // 402 余额不足
        if (statusCode === 402) {
            return `💳 OpenRouter 账户余额不足\n\n请前往 openrouter.ai 充值后重试`;
        }
        
        // 403 地区限制或权限问题
        if (statusCode === 403) {
            if (errorMessage.includes('region') || errorMessage.includes('not available')) {
                return `🌍 模型 ${modelName} 在你的地区不可用\n\n💡 建议:\n• 切换到 DeepSeek V3\n• 切换到 Qwen 2.5 系列\n• 使用 Google Gemini（需 Google API Key）`;
            }
            return `🚫 无权访问模型 ${modelName}\n\n请检查 API Key 权限或切换其他模型`;
        }
        
        // 429 配额超限
        if (statusCode === 429) {
            return `⚠️ OpenRouter 请求频率过高\n\n请稍等片刻后重试`;
        }
        
        // 500+ 服务器错误
        if (statusCode >= 500) {
            return `⚠️ OpenRouter 服务暂时不可用\n\n请稍后重试`;
        }
        
        // 模型不存在
        if (statusCode === 404 || errorMessage.includes('not found')) {
            return `❌ 模型 ${modelName} 不存在\n\n请在设置中选择其他模型`;
        }
        
        // 默认错误
        return `❌ OpenRouter 调用失败 (${statusCode})\n\n${errorMessage.substring(0, 150)}`;
    }

    /**
     * OpenAI API
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     */
    private async chatOpenAI(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        return this.chatOpenAICompatible(this.openai, 'OpenAI', model, messages, options);
    }

    private async chatXiaomi(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        return this.chatOpenAICompatible(this.xiaomi, 'Xiaomi MiMo', model, messages, options);
    }

    private async chatGPTsAPI(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        return this.chatOpenAICompatible(this.gptsapi, 'GPTs API', model, messages, options);
    }

    private async chatDeepSeek(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        const textOnlyMessages = this.toTextOnlyMessages(messages);
        return this.chatOpenAICompatible(this.deepseek, 'DeepSeek', model, textOnlyMessages, options);
    }

    async testDeepSeek(apiKey?: string): Promise<DeepSeekTestResult> {
        const key = (apiKey ?? this.config.deepseekApiKey ?? '').trim();

        if (!key) {
            return {
                success: false,
                error: '请先输入 DeepSeek 官方 API Key。',
                baseUrl: DEEPSEEK_BASE_URL,
                model: DEEPSEEK_TEST_MODEL
            };
        }

        const client = new OpenAI({
            apiKey: key,
            baseURL: DEEPSEEK_BASE_URL,
            timeout: 30000,
            httpAgent: getOpenAIHttpAgent()
        });

        try {
            const response = await client.chat.completions.create({
                model: DEEPSEEK_TEST_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: '连接测试：请只回复 OK。'
                    }
                ],
                max_tokens: 64,
                temperature: 0,
                // 连通性测试只验证 API Key、模型权限和文本输出，不测试思考模式。
                // DeepSeek 默认开启 thinking，低 token 预算下可能只返回 reasoning_content，导致误判。
                thinking: { type: 'disabled' }
            } as any);

            const message = response.choices?.[0]?.message as any;
            const content = message?.content?.trim() || '';
            const reasoningContent = message?.reasoning_content?.trim() || '';
            if (!content) {
                if (reasoningContent) {
                    return {
                        success: true,
                        message: `DeepSeek 官方 API 连接成功，模型 ${DEEPSEEK_TEST_MODEL} 返回了 reasoning_content，但未返回最终文本。通常是思考模式或输出 token 预算导致；当前测试已按非思考模式重试逻辑收口。`,
                        baseUrl: DEEPSEEK_BASE_URL,
                        model: DEEPSEEK_TEST_MODEL,
                        usage: {
                            inputTokens: response.usage?.prompt_tokens || 0,
                            outputTokens: response.usage?.completion_tokens || 0
                        }
                    };
                }
                return {
                    success: false,
                    error: `DeepSeek 已响应，但模型 ${DEEPSEEK_TEST_MODEL} 没有返回最终文本。请稍后重试，或检查该模型在当前账号下是否可用。`,
                    baseUrl: DEEPSEEK_BASE_URL,
                    model: DEEPSEEK_TEST_MODEL,
                    usage: {
                        inputTokens: response.usage?.prompt_tokens || 0,
                        outputTokens: response.usage?.completion_tokens || 0
                    }
                };
            }

            return {
                success: true,
                message: `DeepSeek 官方 API 连接成功，模型 ${DEEPSEEK_TEST_MODEL} 已返回文本。`,
                baseUrl: DEEPSEEK_BASE_URL,
                model: DEEPSEEK_TEST_MODEL,
                usage: {
                    inputTokens: response.usage?.prompt_tokens || 0,
                    outputTokens: response.usage?.completion_tokens || 0
                }
            };
        } catch (error: any) {
            return {
                success: false,
                error: this.formatDeepSeekTestError(error),
                status: error?.status || error?.statusCode,
                baseUrl: DEEPSEEK_BASE_URL,
                model: DEEPSEEK_TEST_MODEL
            };
        }
    }

    private formatDeepSeekTestError(error: any): string {
        const status = error?.status || error?.statusCode || error?.response?.status;
        const message = String(error?.message || error || '');

        if (status === 401 || status === 403) {
            return 'DeepSeek API Key 无效、已过期或没有权限。请在 DeepSeek 平台重新创建官方 API Key。';
        }

        if (status === 404) {
            return `DeepSeek 官方接口已响应，但模型 ${DEEPSEEK_TEST_MODEL} 不存在或当前账号不可用。`;
        }

        if (status === 429) {
            return 'DeepSeek 官方 API 返回频率限制或余额限制。请稍后重试或检查平台额度。';
        }

        if (status && status >= 500) {
            return `DeepSeek 官方服务暂时不可用 (${status})。请稍后重试。`;
        }

        if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|connection|connect|timeout/i.test(message)) {
            return `无法连接 DeepSeek 官方 API：${DEEPSEEK_BASE_URL}。请检查网络或代理设置。`;
        }

        if (/invalid api key|unauthorized|forbidden/i.test(message)) {
            return 'DeepSeek API Key 验证失败。请确认填入的是官方平台创建的 API Key。';
        }

        return `DeepSeek 测试失败：${message.slice(0, 240)}`;
    }

    formatXiaomiError(error: any, modelName: string): string {
        const status = error?.status || error?.statusCode || error?.response?.status;
        const rawMessage = String(
            error?.response?.data?.error?.message ||
            error?.error?.message ||
            error?.message ||
            error ||
            ''
        );
        const message = rawMessage.trim();
        const modelLabel = modelName || 'mimo-v2.5';

        if (status === 400) {
            if (/reasoning_content/i.test(message)) {
                return [
                    `小米 MiMo 请求上下文不完整：${modelLabel} 要求工具调用历史完整回传 reasoning_content。`,
                    '当前 Agent 的 Xiaomi 工具模式会主动关闭思考模式；如果仍出现该错误，通常说明历史消息或上游适配层漏回传了 reasoning_content。',
                    '请重新发起本轮任务，或切换到非思考模式/其它已验证模型后继续。'
                ].join('\n');
            }
            return [
                `小米 MiMo 请求格式错误：${modelLabel} 没有接受当前请求。`,
                '请检查消息格式、模型名称、参数范围、多模态图片格式，以及是否混入了不完整的工具调用历史。',
                message ? `接口返回：${message.slice(0, 240)}` : ''
            ].filter(Boolean).join('\n');
        }

        if (status === 401) {
            return '小米 MiMo API Key 无效或请求头格式不正确。请检查设置中的 Xiaomi API Key。';
        }

        if (status === 402) {
            return '小米 MiMo 账户余额不足。请检查账户余额或 Token Plan 套餐额度。';
        }

        if (status === 403) {
            return '小米 MiMo 当前拒绝访问，可能是地区限制、API Key 风控或内容安全策略触发。请检查 API Key 状态和输入内容。';
        }

        if (status === 404) {
            return `小米 MiMo 模型或接口不可用：${modelLabel}。请确认已切换到 V2.5 系列，并且当前模型支持所需能力。`;
        }

        if (status === 421) {
            return '小米 MiMo 内容安全审核拦截了本次请求。请调整输入内容后重试。';
        }

        if (status === 429) {
            return '小米 MiMo 请求过于频繁或额度已耗尽。请稍后重试；高并发任务应降低请求频率并使用指数退避。';
        }

        if (status === 500 || status === 503) {
            return `小米 MiMo 服务暂时不可用 (${status})。请稍后重试；如果连续出现，可临时切换到备用模型。`;
        }

        if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|connection|connect|timeout/i.test(message)) {
            return '无法连接小米 MiMo API。请检查网络、代理设置，以及 https://api.xiaomimimo.com/v1 是否可访问。';
        }

        if (/invalid api key|unauthorized|forbidden/i.test(message)) {
            return '小米 MiMo API Key 验证失败。请确认使用的是小米开放平台创建的 API Key，且没有混用 Token Plan Key。';
        }

        return `小米 MiMo 调用失败：${message.slice(0, 240) || '未知错误'}`;
    }

    private toTextOnlyMessages(messages: ModelMessage[]): ModelMessage[] {
        return messages.map((msg) => {
            if (typeof msg.content === 'string') {
                return msg;
            }

            const text = msg.content
                .filter((part) => part.type === 'text' && part.text)
                .map((part) => part.text)
                .join('\n');

            return {
                ...msg,
                content: text
            };
        });
    }

    private resolveThinkingRequestParams(model: ModelConfig, options?: ModelChatOptions): Record<string, any> {
        if (options?.thinkingEnabled === false) {
            if (model.provider === 'deepseek' || model.provider === 'xiaomi') {
                return { thinking: { type: 'disabled' } };
            }
            return {};
        }
        return getThinkingRequestParams(model.thinking);
    }

    private extractThinkingForResponse(
        rawResponse: any,
        model: ModelConfig,
        options?: ModelChatOptions
    ): { thinking: string; content: string } {
        if (options?.thinkingEnabled === false) {
            return extractThinking(rawResponse, 'none');
        }
        return extractThinkingFromModel(rawResponse, model.thinking);
    }

    private async chatOpenAICompatible(
        client: OpenAI | null,
        providerName: string,
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        if (!client) {
            throw new Error(`${providerName} API key not configured`);
        }

        const openaiMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: this.convertToOpenAIContent(msg.content)
        }));

        const thinkingParams = this.resolveThinkingRequestParams(model, options);
        const isXiaomiMimo = providerName === 'Xiaomi MiMo';
        const resolvedMaxTokens = resolveChatMaxTokens(options);

        let response: any;
        try {
            const tokenBudgetParams = isXiaomiMimo
                ? { max_completion_tokens: resolvedMaxTokens }
                : { max_tokens: resolvedMaxTokens };
            response = await client.chat.completions.create(
                {
                    model: model.apiModelId || model.id,
                    messages: openaiMessages,
                    ...tokenBudgetParams,
                    temperature: options?.temperature ?? (isXiaomiMimo ? XIAOMI_MIMO_DEFAULT_TEMPERATURE : undefined),
                    ...(isXiaomiMimo
                        ? { top_p: XIAOMI_MIMO_DEFAULT_TOP_P, ...thinkingParams }
                        : thinkingParams)
                } as any,
                { timeout: resolveOpenAICompatibleTimeoutMs(options) } as any
            );
        } catch (error: any) {
            if (isXiaomiMimo) {
                throw new Error(this.formatXiaomiError(error, model.apiModelId || model.id));
            }
            throw error;
        }

        // 使用统一的 ThinkingExtractor 提取思维过程
        const { thinking, content } = this.extractThinkingForResponse(response, model, options);

        return {
            text: content,
            thinking: thinking || undefined,
            usage: {
                inputTokens: response.usage?.prompt_tokens || 0,
                outputTokens: response.usage?.completion_tokens || 0
            }
        };
    }

    /**
     * Ollama API (本地模型) - 使用原生 http 模块
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     */
    private async chatOllama(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        const ollamaModel = (model as any).apiModelId || model.id.replace('ollama-', '');
        console.log(`[ModelService] Calling Ollama model: ${ollamaModel}`);

        const ollamaMessages = messages.map(msg => {
            const baseMessage: any = {
                role: msg.role,
                content: typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
            };

            if (model.supportsVision && typeof msg.content !== 'string') {
                const images = msg.content
                    .filter(c => c.type === 'image' && c.image)
                    .map(c => c.image!.data);
                if (images.length > 0) {
                    baseMessage.images = images;
                }
            }

            return baseMessage;
        });

        // 获取思维过程请求参数
        const thinkingParams = this.resolveThinkingRequestParams(model, options);

        const requestBody = JSON.stringify({
            model: ollamaModel,
            messages: ollamaMessages,
            stream: false,
            options: {
                num_predict: resolveChatMaxTokens(options),
                temperature: options?.temperature ?? 0.7,
                ...thinkingParams
            }
        });

        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 180000  // 3 分钟，大模型（如 32B）冷启动需 1–2 分钟
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`Ollama error (${res.statusCode}): ${data}`));
                            return;
                        }

                        const parsed = JSON.parse(data);
                        
                        // 使用统一的 ThinkingExtractor 提取思维过程
                        const { thinking, content } = this.extractThinkingForResponse(parsed, model, options);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.prompt_eval_count || 0,
                                outputTokens: parsed.eval_count || 0
                            }
                        });
                    } catch (e) {
                        reject(new Error(`Failed to parse Ollama response: ${e}`));
                    }
                });
            });

            req.on('error', (error) => {
                console.error('[ModelService] Ollama connection error:', error.message);
                const hint = error.message?.includes('ECONNREFUSED') 
                    ? 'Ollama 可能未启动，请运行 ollama serve'
                    : '请检查 Ollama 是否正常运行';
                reject(new Error(`🖥️ 无法连接到本地 Ollama 服务\n\n${hint}\n• 或在设置中切换到云端模式`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ Ollama 响应超时 (3 分钟)\n\n可能原因:\n• 大模型（如 32B）首次加载需 1–2 分钟，请稍后重试\n• 可先运行 ollama run qwen2.5:32b 预热模型\n• 或切换到更小的模型（如 qwen2.5:7b）`));
            });

            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Ollama Cloud API (云端 Ollama 服务)
     * 需要 ollamaApiKey 认证
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     * 支持 Qwen3 的 enable_thinking 参数
     */
    private async chatOllamaCloud(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.config.ollamaApiKey) {
            throw new Error('Ollama Cloud API key not configured. 请在设置中配置 Ollama 云服务 API 密钥。');
        }

        const ollamaModel = (model as any).apiModelId || model.id.replace('ollama-cloud-', '');
        console.log(`[ModelService] Calling Ollama Cloud model: ${ollamaModel}`);

        const ollamaMessages = messages.map(msg => {
            const baseMessage: any = {
                role: msg.role,
                content: typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
            };

            if (model.supportsVision && typeof msg.content !== 'string') {
                const images = msg.content
                    .filter(c => c.type === 'image' && c.image)
                    .map(c => c.image!.data);
                if (images.length > 0) {
                    baseMessage.images = images;
                }
            }

            return baseMessage;
        });

        // 获取思维过程请求参数（如 Qwen3 的 enable_thinking）
        const thinkingParams = this.resolveThinkingRequestParams(model, options);
        
        const response = await fetch('https://ollama.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.ollamaApiKey}`
            },
            body: JSON.stringify({
                model: ollamaModel,
                messages: ollamaMessages,
                stream: false,
                options: {
                    num_predict: resolveChatMaxTokens(options),
                    temperature: options?.temperature ?? 0.7,
                    ...thinkingParams  // 添加思维过程参数
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama Cloud error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        
        // 使用统一的 ThinkingExtractor 提取思维过程
        const { thinking, content } = this.extractThinkingForResponse(data, model, options);
        
        return {
            text: content,
            thinking: thinking || undefined,
            usage: {
                inputTokens: data.prompt_eval_count || 0,
                outputTokens: data.eval_count || 0
            }
        };
    }

    /**
     * OpenRouter API (中转模型) - 支持中国地区访问
     * API 格式与 OpenAI 兼容
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     */
    private async chatOpenRouter(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.config.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured. 请在设置中配置 OpenRouter API 密钥。');
        }

        const openrouterModel = (model as any).apiModelId || model.id.replace('openrouter-', '');
        console.log(`[ModelService] Calling OpenRouter model: ${openrouterModel}`);

        const openrouterMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: this.convertToOpenAIContent(msg.content)
        }));
        const thinkingParams = this.resolveThinkingRequestParams(model, options);

        const requestBody = JSON.stringify({
            model: openrouterModel,
            messages: openrouterMessages,
            max_tokens: resolveChatMaxTokens(options),
            temperature: options?.temperature ?? 0.7,
            ...thinkingParams
        });

        return new Promise((resolve, reject) => {
            const https = require('https');

            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 60000
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            let errorData: any = {};
                            try { errorData = JSON.parse(data); } catch {}
                            reject(new Error(this.formatOpenRouterError(res.statusCode, errorData, openrouterModel)));
                            return;
                        }

                        const parsed = JSON.parse(data);
                        
                        // 使用统一的 ThinkingExtractor 提取思维过程
                        const { thinking, content } = this.extractThinkingForResponse(parsed, model, options);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.usage?.prompt_tokens || 0,
                                outputTokens: parsed.usage?.completion_tokens || 0
                            }
                        });
                    } catch (e) {
                        reject(new Error(`❌ OpenRouter 响应解析失败\n\n请稍后重试`));
                    }
                });
            });

            req.on('error', (error: any) => {
                console.error('[ModelService] OpenRouter connection error:', error.message);
                reject(new Error(`🌐 无法连接到 OpenRouter\n\n请检查:\n• 网络连接是否正常\n• 是否需要代理`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ OpenRouter 请求超时\n\n请稍后重试，或切换到响应更快的模型`));
            });

            req.write(requestBody);
            req.end();
        });
    }

    // ===== 格式转换辅助方法 =====

    private convertToAnthropicContent(content: string | MessageContent[]): any {
        if (typeof content === 'string') {
            return content;
        }
        return content.map(c => {
            if (c.type === 'text') {
                return { type: 'text', text: c.text };
            } else if (c.type === 'image' && c.image) {
                return {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: c.image.mediaType,
                        data: c.image.data
                    }
                };
            }
            return null;
        }).filter(Boolean);
    }

    private convertToGeminiContent(messages: ModelMessage[]): any[] {
        const parts: any[] = [];
        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                parts.push({ text: msg.content });
            } else {
                for (const c of msg.content) {
                    if (c.type === 'text' && c.text) {
                        parts.push({ text: c.text });
                    } else if (c.type === 'image' && c.image) {
                        parts.push({
                            inlineData: {
                                mimeType: c.image.mediaType,
                                data: c.image.data
                            }
                        });
                    }
                }
            }
        }
        return parts;
    }

    private convertToOpenAIContent(content: string | MessageContent[]): any {
        if (typeof content === 'string') {
            return content;
        }
        return content.map(c => {
            if (c.type === 'text') {
                return { type: 'text', text: c.text };
            } else if (c.type === 'image' && c.image) {
                return {
                    type: 'image_url',
                    image_url: {
                        url: `data:${c.image.mediaType};base64,${c.image.data}`
                    }
                };
            }
            return null;
        }).filter(Boolean);
    }

    // ==================== Tool Use 支持 ====================

    /**
     * 带工具调用的聊天接口
     *
     * 跨所有 Provider 统一 tool use：
     * - Anthropic: 原生 tool_use content blocks
     * - OpenAI / OpenRouter: 原生 function calling
     * - Gemini: 原生 functionDeclarations
     * - Ollama: 原生（llama3.1+）或 prompt-based XML 兼容模式
     */
    async chatWithTools(
        modelId: string,
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: ModelToolCallOptions
    ): Promise<ProviderResponse> {
        console.log(`[ModelService] chatWithTools() modelId=${modelId}, tools=${tools.length}, messages=${messages.length}`);

        const configuredModel = getModelById(modelId);
        if (configuredModel && configuredModel.supportsToolUse === false) {
            throw new Error(`模型 ${configuredModel.name} 不支持工具调用，请为执行链选择支持 chatWithTools 的模型。`);
        }

        // Resolve provider
        const { provider, apiModelName } = this.resolveProvider(modelId);
        const adapter = getProviderAdapter(provider, apiModelName);
        const thinkingRequestParams = configuredModel
            ? this.resolveThinkingRequestParams(configuredModel, options)
            : {};

        // Format request using adapter
        const formatted = adapter.formatMessages(messages, tools, {
            maxTokens: options?.maxTokens,
            temperature: options?.temperature,
            nativeTools: options?.nativeTools,
            thinkingEnabled: options?.thinkingEnabled,
            thinkingRequestParams
        });

        // Call the appropriate provider API
        let rawResponse: any;

        switch (provider) {
            case 'anthropic': {
                if (!this.anthropic) throw new Error('Anthropic API key not configured');
                rawResponse = await this.anthropic.messages.create({
                    model: apiModelName,
                    ...formatted
                });
                break;
            }
            case 'openai': {
                if (!this.openai) throw new Error('OpenAI API key not configured');
                rawResponse = await this.openai.chat.completions.create({
                    model: apiModelName,
                    ...formatted
                });
                break;
            }
            case 'xiaomi': {
                if (!this.xiaomi) throw new Error('Xiaomi MiMo API key not configured');
                try {
                    rawResponse = await this.xiaomi.chat.completions.create(
                        {
                            model: apiModelName,
                            ...formatted
                        },
                        options?.timeoutMs ? { timeout: options.timeoutMs } : undefined
                    );
                } catch (error: any) {
                    throw new Error(this.formatXiaomiError(error, apiModelName));
                }
                break;
            }
            case 'gptsapi': {
                if (!this.gptsapi) throw new Error('GPTs API key not configured');
                rawResponse = await this.gptsapi.chat.completions.create({
                    model: apiModelName,
                    ...formatted
                });
                break;
            }
            case 'deepseek': {
                if (!this.deepseek) throw new Error('DeepSeek API key not configured');
                // thinking 请求参数已由 adapter.formatMessages 按 thinkingEnabled + thinkingRequestParams 写入 formatted。
                // 此处不再按 provider 名覆盖，避免把模型能力判断散落到调用点。
                rawResponse = await this.deepseek.chat.completions.create({
                    model: apiModelName,
                    ...formatted
                } as any);
                break;
            }
            case 'google': {
                if (!this.gemini) throw new Error('Google API key not configured');
                const genModel = this.gemini.getGenerativeModel({
                    model: apiModelName,
                    ...formatted.generationConfig ? { generationConfig: formatted.generationConfig } : {}
                });
                const genResult = await genModel.generateContent({
                    contents: formatted.contents,
                    tools: formatted.tools,
                    ...(formatted.toolConfig ? { toolConfig: formatted.toolConfig } : {}),
                    ...(formatted.systemInstruction ? { systemInstruction: formatted.systemInstruction } : {})
                });
                rawResponse = genResult.response;
                break;
            }
            case 'openrouter': {
                if (!this.config.openrouterApiKey) throw new Error('OpenRouter API key not configured');
                rawResponse = await this.callOpenRouterWithTools(apiModelName, formatted);
                break;
            }
            case 'ollama':
            case 'ollama-cloud': {
                rawResponse = await this.callOllamaWithTools(apiModelName, formatted, provider === 'ollama-cloud');
                break;
            }
            default:
                throw new Error(`chatWithTools: unsupported provider ${provider}`);
        }

        // Parse response using adapter
        const parsed = adapter.parseResponse(rawResponse);
        console.log(`[ModelService] chatWithTools result: provider=${provider}, model=${apiModelName}, content=${(parsed.content || '').length}chars, toolCalls=${parsed.toolCalls?.length || 0}, stop=${parsed.stopReason}`);
        if (!parsed.toolCalls?.length && parsed.content) {
            console.log(`[ModelService] chatWithTools: model returned text only (no tool calls). First 200 chars: ${parsed.content.substring(0, 200)}`);
        }
        return parsed;
    }

    /**
     * 用小米 MiMo 原生 web_search 联网检索设计资料。
     *
     * 这是「找参考 / 查趋势」的主搜索通道——MiMo 会真正联网搜索并返回带来源(citations)的综合结论。
     * 与失败的 design-crawler 爬虫、冷启动慢的 Eagle 不同，这条路实测稳定出活。
     * 注意：联网搜索 + 生成通常需要 30-50 秒，调用方必须保证足够长的超时。
     */
    async searchDesignWebViaXiaomi(
        query: string,
        options?: {
            limit?: number;
            maxKeyword?: number;
            forceSearch?: boolean;
            userLocation?: string;
        }
    ): Promise<{
        available: boolean;
        content: string;
        citations: ProviderNativeToolCitation[];
        error?: string;
    }> {
        if (!this.xiaomi) {
            return {
                available: false,
                content: '',
                citations: [],
                error: '未配置小米 MiMo API Key，无法联网搜索设计资料。'
            };
        }
        const trimmed = String(query || '').trim();
        if (!trimmed) {
            return { available: false, content: '', citations: [], error: '搜索关键词为空。' };
        }
        const limit = Math.max(1, Math.min(10, Math.floor(options?.limit ?? 6)));
        const maxKeyword = Math.max(1, Math.min(5, Math.floor(options?.maxKeyword ?? 3)));
        const nativeToolPlan = buildProviderNativeToolPlan({
            provider: 'xiaomi',
            modelId: 'mimo-v2.5-pro',
            requestedTools: [{
                type: 'web_search',
                enabled: true,
                limit,
                maxKeyword,
                forceSearch: options?.forceSearch === true,
                userLocation: options?.userLocation
            }]
        });
        const prompt = `请联网搜索与「${trimmed}」相关的设计资料。`
            + `严格聚焦查询中的产品属性（季节、品类、材质、风格、受众）——只返回与这些属性一致的参考，`
            + `明确排除季节或品类不符的内容（例如查询是春夏薄款，就不要纳入秋冬加厚款的参考）。`
            + `重点给出可直接用于设计决策的内容：主流趋势方向、配色与版式要点、文案与卖点表达方式，`
            + `并为每条参考标注它与查询的契合点（季节/品类/风格是否一致）。`
            + `只总结可借鉴的风格方向与方法，不要照抄任何单一成品。`;
        try {
            const resp = await this.chatWithTools(
                'xiaomi-mimo-v2.5-pro',
                [{ role: 'user', content: prompt }],
                [],
                {
                    nativeTools: nativeToolPlan.nativeTools,
                    maxTokens: 4000,
                    // 联网搜索 + 生成约 45-55 秒，client 默认 45 秒超时不够，放宽到 60 秒——
                    // 覆盖正常产出区间，又不让挂起通道一次吃掉设计循环近三分之一的时间预算。
                    timeoutMs: 60_000
                }
            );
            return {
                available: true,
                content: resp.content || '',
                citations: Array.isArray(resp.citations) ? resp.citations : []
            };
        } catch (error: any) {
            return {
                available: false,
                content: '',
                citations: [],
                error: this.formatXiaomiError(error, 'mimo-v2.5-pro')
            };
        }
    }

    /**
     * 带工具调用的流式聊天接口。
     *
     * 只把 provider 真实返回的增量作为事件发出；不支持工具流的 provider 会降级为
     * chatWithTools 的一次性结果，并在 done.response.streamMode 中标记为 fallback。
     */
    chatWithToolsStream(
        modelId: string,
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: ModelToolCallOptions
    ): AgentToolStreamHandle {
        const emitter = new EventEmitter() as AgentToolStreamHandle;
        const abortController = new AbortController();
        let aborted = false;

        const emitChunk = (chunk: AgentToolStreamChunk): void => {
            if (aborted && chunk.type !== 'error') return;
            emitter.emit('chunk', chunk);
        };

        emitter.abort = () => {
            aborted = true;
            abortController.abort();
        };

        setImmediate(() => {
            this.runChatWithToolsStream(
                modelId,
                messages,
                tools,
                options,
                abortController.signal,
                emitChunk
            ).catch((error: any) => {
                if (!aborted) {
                    emitChunk({ type: 'error', error: error?.message || String(error) });
                }
            });
        });

        return emitter;
    }

    private async runChatWithToolsStream(
        modelId: string,
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options: ModelToolCallOptions | undefined,
        signal: AbortSignal,
        emitChunk: (chunk: AgentToolStreamChunk) => void
    ): Promise<void> {
        const configuredModel = getModelById(modelId);
        if (configuredModel && configuredModel.supportsToolUse === false) {
            throw new Error(`模型 ${configuredModel.name} 不支持工具调用，请为执行链选择支持 chatWithTools 的模型。`);
        }

        const { provider, apiModelName } = this.resolveProvider(modelId);
        const adapter = getProviderAdapter(provider, apiModelName);
        const thinkingRequestParams = configuredModel
            ? this.resolveThinkingRequestParams(configuredModel, options)
            : {};
        const formatted = adapter.formatMessages(messages, tools, {
            maxTokens: options?.maxTokens,
            temperature: options?.temperature,
            nativeTools: options?.nativeTools,
            thinkingEnabled: options?.thinkingEnabled,
            thinkingRequestParams
        });

        if (provider === 'openrouter') {
            await this.streamOpenRouterWithTools(apiModelName, formatted, signal, emitChunk);
            return;
        }

        const client = this.getOpenAICompatibleClient(provider);
        if (client) {
            await this.streamOpenAICompatibleWithTools(
                provider,
                client,
                apiModelName,
                formatted,
                signal,
                emitChunk
            );
            return;
        }

        const parsed = await this.chatWithTools(modelId, messages, tools, options);
        emitChunk({
            type: 'done',
            response: this.toAgentToolStreamResponse(parsed, 'fallback')
        });
    }

    private getOpenAICompatibleClient(provider: string): OpenAI | null {
        switch (provider) {
            case 'openai':
                return this.openai;
            case 'xiaomi':
                return this.xiaomi;
            case 'gptsapi':
                return this.gptsapi;
            case 'deepseek':
                return this.deepseek;
            default:
                return null;
        }
    }

    private async streamOpenAICompatibleWithTools(
        provider: string,
        client: OpenAI,
        model: string,
        formatted: any,
        signal: AbortSignal,
        emitChunk: (chunk: AgentToolStreamChunk) => void
    ): Promise<void> {
        const accumulatedToolCalls = new Map<number, AccumulatedToolCall>();
        let content = '';
        let thinking = '';
        let usage = { inputTokens: 0, outputTokens: 0 };
        const annotations: unknown[] = [];
        let webSearchUsage: unknown;
        let providerFinishReason: string | undefined;

        let stream: any;
        try {
            stream = await client.chat.completions.create({
                model,
                ...formatted,
                stream: true
                // thinking 请求参数已由 adapter.formatMessages 写入 formatted；这里不按 provider 名覆盖。
            } as any, { signal } as any);
        } catch (error: any) {
            if (provider === 'xiaomi') {
                throw new Error(this.formatXiaomiError(error, model));
            }
            throw error;
        }

        try {
            for await (const chunk of stream as any) {
                if (signal.aborted) return;
                const choice = chunk?.choices?.[0];
                if (choice?.finish_reason) {
                    providerFinishReason = String(choice.finish_reason);
                }
                const delta = choice?.delta;
                if (!delta) continue;

                if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
                    const norm = normalizeStreamTextChunk(thinking, delta.reasoning_content);
                    thinking = norm.fullText;
                    if (norm.deltaText) emitChunk({ type: 'thinking_delta', thinking: norm.deltaText });
                }

                if (typeof delta.content === 'string' && delta.content) {
                    content += delta.content;
                    emitChunk({ type: 'content_delta', content: delta.content });
                }

                if (Array.isArray(delta.annotations)) {
                    annotations.push(...delta.annotations);
                }

                this.consumeToolCallDeltas(delta.tool_calls, accumulatedToolCalls, emitChunk);

                if (chunk.usage) {
                    usage = {
                        inputTokens: chunk.usage.prompt_tokens || 0,
                        outputTokens: chunk.usage.completion_tokens || 0
                    };
                    if (chunk.usage.web_search_usage) {
                        webSearchUsage = chunk.usage.web_search_usage;
                    }
                }
            }
        } catch (error: any) {
            if (provider === 'xiaomi') {
                throw new Error(this.formatXiaomiError(error, model));
            }
            throw error;
        }

        const toolCalls = providerFinishReason === 'length'
            ? []
            : buildToolCallsFromDeltas(accumulatedToolCalls);
        const citations = provider === 'xiaomi'
            ? normalizeProviderNativeToolCitations(annotations, { provider: 'xiaomi' })
            : [];
        for (const toolCall of toolCalls) {
            emitChunk({ type: 'tool_call_ready', toolCall });
        }
        emitChunk({
            type: 'done',
            response: {
                content,
                thinking: thinking || undefined,
                toolCalls,
                usage,
                citations,
                nativeToolUsage: provider === 'xiaomi' && webSearchUsage
                    ? [{ provider: 'xiaomi', toolType: 'web_search', rawUsage: webSearchUsage }]
                    : undefined,
                stopReason: normalizeProviderStreamStopReason(providerFinishReason, toolCalls.length > 0),
                streamMode: 'stream'
            }
        });
    }

    private streamOpenRouterWithTools(
        model: string,
        formatted: any,
        signal: AbortSignal,
        emitChunk: (chunk: AgentToolStreamChunk) => void
    ): Promise<void> {
        if (!this.config.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        return new Promise((resolve, reject) => {
            const https = require('https');
            const accumulatedToolCalls = new Map<number, AccumulatedToolCall>();
            let content = '';
            let thinking = '';
            let buffer = '';
            let usage = { inputTokens: 0, outputTokens: 0 };
            let settled = false;
            let providerFinishReason: string | undefined;

            const finish = (): void => {
                if (settled || signal.aborted) return;
                settled = true;
                const toolCalls = providerFinishReason === 'length'
                    ? []
                    : buildToolCallsFromDeltas(accumulatedToolCalls);
                for (const toolCall of toolCalls) {
                    emitChunk({ type: 'tool_call_ready', toolCall });
                }
                emitChunk({
                    type: 'done',
                    response: {
                        content,
                        thinking: thinking || undefined,
                        toolCalls,
                        usage,
                        stopReason: normalizeProviderStreamStopReason(providerFinishReason, toolCalls.length > 0),
                        streamMode: 'stream'
                    }
                });
                resolve();
            };

            const requestBody = JSON.stringify({
                model,
                ...formatted,
                stream: true
            });

            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 120000
            }, (res: any) => {
                if (res.statusCode !== 200) {
                    let errorBody = '';
                    res.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
                    res.on('end', () => reject(new Error(this.formatOpenRouterError(res.statusCode, safeParseToolArguments(errorBody), model))));
                    return;
                }

                res.on('data', (chunk: Buffer) => {
                    if (signal.aborted) return;
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const data = line.slice(6).trim();
                        if (!data) continue;
                        if (data === '[DONE]') {
                            finish();
                            return;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const choice = parsed.choices?.[0];
                            if (choice?.finish_reason) {
                                providerFinishReason = String(choice.finish_reason);
                            }
                            const delta = choice?.delta;
                            if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
                                const norm = normalizeStreamTextChunk(thinking, delta.reasoning_content);
                                thinking = norm.fullText;
                                if (norm.deltaText) emitChunk({ type: 'thinking_delta', thinking: norm.deltaText });
                            }
                            if (typeof delta?.content === 'string' && delta.content) {
                                content += delta.content;
                                emitChunk({ type: 'content_delta', content: delta.content });
                            }
                            this.consumeToolCallDeltas(delta?.tool_calls, accumulatedToolCalls, emitChunk);
                            if (parsed.usage) {
                                usage = {
                                    inputTokens: parsed.usage.prompt_tokens || 0,
                                    outputTokens: parsed.usage.completion_tokens || 0
                                };
                            }
                        } catch {
                            // Ignore malformed SSE fragments.
                        }
                    }
                });

                res.on('end', finish);
                res.on('error', (error: Error) => reject(error));
            });

            req.on('error', (error: Error) => {
                if (!signal.aborted) reject(error);
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('OpenRouter timeout'));
            });
            signal.addEventListener('abort', () => req.destroy());
            req.write(requestBody);
            req.end();
        });
    }

    private consumeToolCallDeltas(
        deltas: any,
        accumulatedToolCalls: Map<number, AccumulatedToolCall>,
        emitChunk: (chunk: AgentToolStreamChunk) => void
    ): void {
        if (!Array.isArray(deltas)) return;

        for (const delta of deltas) {
            const index = typeof delta.index === 'number' ? delta.index : accumulatedToolCalls.size;
            const current = accumulatedToolCalls.get(index) || { argumentsText: '' };
            if (delta.id) current.id = delta.id;
            if (delta.function?.name) current.name = `${current.name || ''}${delta.function.name}`;
            if (delta.function?.arguments) current.argumentsText += delta.function.arguments;
            accumulatedToolCalls.set(index, current);

            emitChunk({
                type: 'tool_call_delta',
                index,
                toolCallId: current.id,
                name: current.name,
                argumentsDelta: delta.function?.arguments
            });
        }
    }

    private toAgentToolStreamResponse(
        response: ProviderResponse,
        streamMode: 'stream' | 'fallback'
    ): AgentToolStreamResponse {
        return {
            content: response.content,
            thinking: response.thinking,
            toolCalls: response.toolCalls,
            usage: response.usage,
            citations: response.citations,
            nativeToolUsage: response.nativeToolUsage,
            stopReason: response.stopReason,
            streamMode
        };
    }

    /**
     * 从 modelId 解析 provider 和 API 模型名
     */
    private resolveProvider(modelId: string): { provider: string; apiModelName: string } {
        const model = getModelById(modelId);
        if (model) {
            let apiModelName = (model as any).apiModelId || model.id;
            // Anthropic model name mapping
            if (model.provider === 'anthropic') {
                if (model.id === 'claude-3-5-sonnet') apiModelName = 'claude-3-5-sonnet-20241022';
                else if (model.id === 'claude-3-opus') apiModelName = 'claude-3-opus-20240229';
            }
            // Google: strip models/ prefix
            if (model.provider === 'google' && apiModelName.startsWith('models/')) {
                apiModelName = apiModelName.replace('models/', '');
            }
            return { provider: model.provider, apiModelName };
        }

        // Dynamic resolution
        if (modelId.startsWith('local-')) {
            return { provider: 'ollama', apiModelName: this.localIdToOllamaModel(modelId) };
        }
        if (modelId.startsWith('ollama-') && !modelId.startsWith('ollama-cloud-')) {
            return { provider: 'ollama', apiModelName: modelId.replace('ollama-', '') };
        }
        if (modelId.startsWith('ollama-cloud-')) {
            return { provider: 'ollama-cloud', apiModelName: modelId.replace('ollama-cloud-', '') };
        }
        if (modelId.startsWith('openrouter-')) {
            return { provider: 'openrouter', apiModelName: modelId.replace('openrouter-', '') };
        }
        if (modelId.startsWith('gptsapi-')) {
            return { provider: 'gptsapi', apiModelName: modelId.replace('gptsapi-', '') };
        }
        if (modelId.startsWith('deepseek-')) {
            return { provider: 'deepseek', apiModelName: modelId };
        }
        if (modelId.startsWith('xiaomi-')) {
            return { provider: 'xiaomi', apiModelName: modelId.replace('xiaomi-', '') };
        }

        throw new Error(`Unknown model: ${modelId}`);
    }

    /**
     * OpenRouter HTTP 调用（带 tools）
     */
    private callOpenRouterWithTools(model: string, formatted: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const requestBody = JSON.stringify({
                model,
                ...formatted
            });
            const https = require('https');
            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 120000
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            let errorData: any = {};
                            try { errorData = JSON.parse(data); } catch {}
                            reject(new Error(this.formatOpenRouterError(res.statusCode, errorData, model)));
                            return;
                        }
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`OpenRouter response parse error: ${e}`));
                    }
                });
            });
            req.on('error', (e: any) => reject(new Error(`OpenRouter connection error: ${e.message}`)));
            req.on('timeout', () => { req.destroy(); reject(new Error('OpenRouter timeout')); });
            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Ollama HTTP 调用（带 tools）
     */
    private callOllamaWithTools(model: string, formatted: any, isCloud: boolean): Promise<any> {
        if (isCloud) {
            return this.callOllamaCloudWithTools(model, formatted);
        }
        return new Promise((resolve, reject) => {
            const requestBody = JSON.stringify({ model, ...formatted });
            const req = http.request({
                hostname: '127.0.0.1',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 180000
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`Ollama error (${res.statusCode}): ${data}`));
                            return;
                        }
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Ollama response parse error: ${e}`));
                    }
                });
            });
            req.on('error', () => reject(new Error('无法连接到本地 Ollama 服务')));
            req.on('timeout', () => { req.destroy(); reject(new Error('Ollama 响应超时')); });
            req.write(requestBody);
            req.end();
        });
    }

    private async callOllamaCloudWithTools(model: string, formatted: any): Promise<any> {
        if (!this.config.ollamaApiKey) throw new Error('Ollama Cloud API key not configured');
        const response = await fetch('https://ollama.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.ollamaApiKey}`
            },
            body: JSON.stringify({ model, ...formatted })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama Cloud error (${response.status}): ${errorText}`);
        }
        return response.json();
    }

    // ==================== 流式输出支持 ====================
    
    /**
     * 流式聊天接口
     * 
     * 返回一个事件发射器，可以监听 'chunk' 事件获取流式数据
     * 
     * @example
     * const stream = modelService.chatStream(modelId, messages);
     * stream.on('chunk', (chunk) => {
     *     if (chunk.type === 'content') {
     *         console.log('内容:', chunk.content);
     *     } else if (chunk.type === 'thinking') {
     *         console.log('思考:', chunk.thinking);
     *     } else if (chunk.type === 'done') {
     *         console.log('完成:', chunk.fullResponse);
     *     }
     * });
     */
    chatStream(
        modelId: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number; thinkingEnabled?: boolean; timeoutMs?: number; signal?: AbortSignal }
    ): import('./stream-adapter').BaseStreamAdapter {
        const { createStreamAdapter } = require('./stream-adapter');
        
        // 从统一配置获取模型信息
        const model = getModelById(modelId);
        
        // 保留多模态 content，由各 provider 的 stream adapter 负责格式转换。
        const streamMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content
        }));
        
        // 确定提供商
        let provider = 'ollama';
        let modelToUse: any = modelId;
        
        if (model) {
            provider = model.provider;
            modelToUse = model;
        } else if (modelId.startsWith('local-') || modelId.startsWith('ollama-')) {
            provider = 'ollama';
            modelToUse = modelId.replace('local-', '').replace('ollama-', '');
        } else if (modelId.startsWith('openrouter-')) {
            provider = 'openrouter';
            modelToUse = modelId.replace('openrouter-', '');
        } else if (modelId.startsWith('xiaomi-')) {
            provider = 'xiaomi';
            modelToUse = modelId.replace('xiaomi-', '');
        } else if (modelId.startsWith('deepseek-')) {
            provider = 'deepseek';
            modelToUse = modelId;
        }
        
        // 创建适配器
        const adapter = createStreamAdapter(provider, {
            ollamaUrl: this.ollamaBaseUrl,
            ollamaApiKey: this.config.ollamaApiKey,
            openrouterApiKey: this.config.openrouterApiKey,
            googleApiKey: this.config.googleApiKey,
            xiaomiApiKey: this.config.xiaomiApiKey,
            anthropicApiKey: this.config.anthropicApiKey,
            openaiApiKey: this.config.openaiApiKey,
            gptsapiApiKey: this.config.gptsapiApiKey,
            deepseekApiKey: this.config.deepseekApiKey
        });
        
        // 开始流式请求
        adapter.stream(modelToUse, streamMessages, options);
        
        return adapter;
    }
}
