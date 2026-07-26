/**
 * 流式输出适配器
 * 
 * 统一处理不同 AI 模型的流式响应，提供一致的接口。
 * 
 * 支持的模型：
 * - Ollama (本地)
 * - OpenRouter (云端)
 * - Google Gemini (云端)
 * - Anthropic Claude (云端)
 * - OpenAI (云端)
 * 
 * 功能：
 * 1. 统一的流式数据格式
 * 2. 思维过程实时提取
 * 3. 错误处理和重试
 * 4. 取消支持
 */

import { EventEmitter } from 'events';
import { ModelConfig } from '../../shared/config/models.config';
import { buildAgentProviderTokenBudget } from '../../shared/agent-performance-policy';
import { normalizeStreamTextChunk } from '../../shared/stream-text-normalizer';
import { getHttpRequestAgent } from './network-proxy';
import { getThinkingRequestParams } from './thinking-extractor';

// ==================== 类型定义 ====================

export interface StreamChunk {
    /** 块类型 */
    type: 'content' | 'thinking' | 'done' | 'error';
    /** 内容片段 */
    content?: string;
    /** 思维过程片段 */
    thinking?: string;
    /** 完成时的完整响应 */
    fullResponse?: {
        text: string;
        thinking?: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        };
    };
    /** 错误信息 */
    error?: string;
}

export interface StreamOptions {
    /** 最大输出 token */
    maxTokens?: number;
    /** 温度 */
    temperature?: number;
    /** 是否请求并显示模型原生 Thinking / reasoning 输出 */
    thinkingEnabled?: boolean;
    /** 调用方预算，当前用于上层取消和日志传递 */
    timeoutMs?: number;
    /** 取消信号 */
    signal?: AbortSignal;
}

export type StreamMessageContent = string | Array<{
    type: 'text' | 'image';
    text?: string;
    image?: {
        data: string;
        mediaType: string;
    };
}>;

export interface StreamMessage {
    role: 'user' | 'assistant' | 'system';
    content: StreamMessageContent;
}

function resolveStreamMaxTokens(options?: StreamOptions): number {
    return buildAgentProviderTokenBudget({
        requestedMaxTokens: options?.maxTokens
    }).maxTokens;
}

function isStreamThinkingEnabled(options?: StreamOptions): boolean {
    return options?.thinkingEnabled !== false;
}

function resolveStreamThinkingRequestParams(
    model: ModelConfig | string,
    options?: StreamOptions
): Record<string, any> {
    if (typeof model === 'string') return {};
    if (!isStreamThinkingEnabled(options)) {
        if (model.provider === 'deepseek' || model.provider === 'xiaomi') {
            return { thinking: { type: 'disabled' } };
        }
        return {};
    }
    return getThinkingRequestParams(model.thinking);
}

function streamContentToText(content: StreamMessageContent): string {
    if (typeof content === 'string') return content;
    return content
        .filter(part => part.type === 'text' && part.text)
        .map(part => part.text)
        .join('\n');
}

function streamContentImages(content: StreamMessageContent): string[] {
    if (typeof content === 'string') return [];
    return content
        .filter(part => part.type === 'image' && part.image?.data)
        .map(part => part.image!.data);
}

function streamContentToOpenAI(content: StreamMessageContent): any {
    if (typeof content === 'string') return content;
    return content.map(part => {
        if (part.type === 'text') {
            return { type: 'text', text: part.text || '' };
        }
        if (part.type === 'image' && part.image?.data) {
            return {
                type: 'image_url',
                image_url: {
                    url: `data:${part.image.mediaType || 'image/png'};base64,${part.image.data}`
                }
            };
        }
        return null;
    }).filter(Boolean);
}

function streamContentToGeminiParts(content: StreamMessageContent): any[] {
    if (typeof content === 'string') return [{ text: content }];
    return content.map(part => {
        if (part.type === 'text') {
            return { text: part.text || '' };
        }
        if (part.type === 'image' && part.image?.data) {
            return {
                inlineData: {
                    mimeType: part.image.mediaType || 'image/png',
                    data: part.image.data
                }
            };
        }
        return null;
    }).filter(Boolean);
}

function compactProviderErrorBody(body: string): string {
    const trimmed = String(body || '').trim();
    if (!trimmed) return '';

    try {
        const parsed = JSON.parse(trimmed);
        const message = parsed?.error?.message || parsed?.message || parsed?.error;
        if (typeof message === 'string' && message.trim()) {
            return message.trim().slice(0, 600);
        }
    } catch {
        // Fall through to the raw body.
    }

    return trimmed.replace(/\s+/g, ' ').slice(0, 600);
}

function attachHttpErrorResponseHandler(
    res: any,
    providerName: string,
    statusCode: number,
    emitError: (message: string) => void,
    isAborted: () => boolean
): void {
    let body = '';

    res.on('data', (chunk: Buffer | string) => {
        body += chunk.toString();
    });

    res.on('end', () => {
        if (isAborted()) return;
        const detail = compactProviderErrorBody(body);
        emitError(`${providerName} HTTP ${statusCode}${detail ? `: ${detail}` : ''}`);
    });

    res.on('error', (err: Error) => {
        if (!isAborted()) {
            emitError(`${providerName} HTTP ${statusCode} 响应读取失败: ${err.message}`);
        }
    });
}

// ==================== 流式适配器基类 ====================

export abstract class BaseStreamAdapter extends EventEmitter {
    protected aborted = false;
    
    constructor() {
        super();
    }
    
    /**
     * 开始流式请求
     */
    abstract stream(
        model: ModelConfig | string,
        messages: StreamMessage[],
        options?: StreamOptions
    ): void;
    
    /**
     * 取消请求
     */
    abort(): void {
        this.aborted = true;
        this.emit('chunk', { type: 'done' } as StreamChunk);
    }
    
    /**
     * 发送内容块
     */
    protected emitContent(content: string): void {
        if (!this.aborted) {
            this.emit('chunk', { type: 'content', content } as StreamChunk);
        }
    }
    
    /**
     * 发送思维过程块
     */
    protected emitThinking(thinking: string): void {
        if (!this.aborted) {
            this.emit('chunk', { type: 'thinking', thinking } as StreamChunk);
        }
    }
    
    /**
     * 发送完成信号
     */
    protected emitDone(fullResponse: StreamChunk['fullResponse']): void {
        if (!this.aborted) {
            this.emit('chunk', { type: 'done', fullResponse } as StreamChunk);
        }
    }
    
    /**
     * 发送错误
     */
    protected emitError(error: string): void {
        this.emit('chunk', { type: 'error', error } as StreamChunk);
    }
}

// ==================== Ollama 流式适配器 ====================

export class OllamaStreamAdapter extends BaseStreamAdapter {
    private baseUrl: string;
    private apiKey?: string;
    
    constructor(baseUrl: string = 'http://127.0.0.1:11434', apiKey?: string) {
        super();
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    
    stream(
        model: ModelConfig | string,
        messages: StreamMessage[],
        options?: StreamOptions
    ): void {
        this.aborted = false;
        
        const modelName = typeof model === 'string' 
            ? model 
            : (model.apiModelId || model.id.replace('local-', ''));
        
        const ollamaMessages = messages.map(msg => {
            const message: any = {
                role: msg.role === 'system' ? 'system' : msg.role,
                content: streamContentToText(msg.content)
            };
            const images = streamContentImages(msg.content);
            if (images.length > 0) {
                message.images = images;
            }
            return message;
        });
        
        const requestBody = JSON.stringify({
            model: modelName,
            messages: ollamaMessages,
            stream: true,
            options: {
                num_predict: resolveStreamMaxTokens(options),
                temperature: options?.temperature ?? 0.7,
                ...resolveStreamThinkingRequestParams(model, options)
            }
        });
        
        const url = new URL(this.baseUrl);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? require('https') : require('http');
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody).toString()
        };
        
        // Ollama Cloud 需要 API Key
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        
        const req = httpModule.request({
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 11434),
            path: '/api/chat',
            method: 'POST',
            headers,
            timeout: 120000
        }, (res: any) => {
            const statusCode = Number(res.statusCode || 0);
            if (statusCode < 200 || statusCode >= 300) {
                attachHttpErrorResponseHandler(
                    res,
                    'Ollama',
                    statusCode,
                    (message) => this.emitError(message),
                    () => this.aborted
                );
                return;
            }

            let fullContent = '';
            let fullThinking = '';
            let buffer = '';
            
            res.on('data', (chunk: Buffer) => {
                if (this.aborted) return;
                
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (!line.trim()) continue;
                    
                    try {
                        const data = JSON.parse(line);
                        
                        if (data.message?.content) {
                            const content = data.message.content;
                            fullContent += content;
                            
                            // 检查是否有思维过程标签
                            if (content.includes('<think>') || fullContent.includes('<think>')) {
                                // 暂时累积，最后统一处理
                            } else {
                                this.emitContent(content);
                            }
                        }
                        
                        if (data.done) {
                            const result = isStreamThinkingEnabled(options)
                                ? this.extractThinking(fullContent)
                                : { thinking: null, content: fullContent };
                            
                            this.emitDone({
                                text: result.content,
                                thinking: result.thinking || undefined,
                                usage: {
                                    inputTokens: data.prompt_eval_count || 0,
                                    outputTokens: data.eval_count || 0
                                }
                            });
                        }
                    } catch {
                        // 忽略解析错误的行
                    }
                }
            });
            
            res.on('end', () => {
                // 处理剩余 buffer
                if (buffer.trim() && !this.aborted) {
                    try {
                        const data = JSON.parse(buffer);
                        if (!data.done) {
                            const result = isStreamThinkingEnabled(options)
                                ? this.extractThinking(fullContent)
                                : { thinking: null, content: fullContent };
                            this.emitDone({
                                text: result.content,
                                thinking: result.thinking || undefined
                            });
                        }
                    } catch {
                        // 忽略
                    }
                }
            });
            
            res.on('error', (err: Error) => {
                this.emitError(err.message);
            });
        });
        
        req.on('error', (err: Error) => {
            this.emitError(`无法连接到 Ollama 服务: ${err.message}`);
        });
        
        req.on('timeout', () => {
            req.destroy();
            this.emitError('Ollama 响应超时');
        });
        
        // 取消支持
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.abort();
                req.destroy();
            });
        }
        
        req.write(requestBody);
        req.end();
    }
    
    /**
     * 提取思维过程
     */
    private extractThinking(content: string): { thinking: string | null; content: string } {
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            return {
                thinking: thinkMatch[1].trim(),
                content: content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
            };
        }
        return { thinking: null, content };
    }
}

// ==================== OpenRouter 流式适配器 ====================

export class OpenRouterStreamAdapter extends BaseStreamAdapter {
    private apiKey: string;
    
    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }
    
    stream(
        model: ModelConfig | string,
        messages: StreamMessage[],
        options?: StreamOptions
    ): void {
        this.aborted = false;
        
        const modelId = typeof model === 'string' 
            ? model 
            : model.apiModelId;
        
        const requestBody = JSON.stringify({
            model: modelId,
            messages: messages.map(m => ({ role: m.role, content: streamContentToOpenAI(m.content) })),
            max_tokens: resolveStreamMaxTokens(options),
            temperature: options?.temperature ?? 0.7,
            stream: true,
            ...resolveStreamThinkingRequestParams(model, options)
        });
        
        const https = require('https');
        const endpoint = new URL('https://openrouter.ai/api/v1/chat/completions');
        
        const req = https.request({
            hostname: endpoint.hostname,
            port: 443,
            path: endpoint.pathname,
            method: 'POST',
            agent: getHttpRequestAgent(endpoint),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
                'HTTP-Referer': 'https://designecho.app',
                'X-Title': 'DesignEcho Agent',
                'Content-Length': Buffer.byteLength(requestBody)
            },
            timeout: 120000
        }, (res: any) => {
            const statusCode = Number(res.statusCode || 0);
            if (statusCode < 200 || statusCode >= 300) {
                attachHttpErrorResponseHandler(
                    res,
                    'OpenRouter',
                    statusCode,
                    (message) => this.emitError(message),
                    () => this.aborted
                );
                return;
            }

            let fullContent = '';
            let fullThinking = '';
            let buffer = '';
            let usage = { inputTokens: 0, outputTokens: 0 };
            
            res.on('data', (chunk: Buffer) => {
                if (this.aborted) return;
                
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        const { thinking, content: cleanContent } = this.extractThinking(fullContent);
                        this.emitDone({
                            text: cleanContent,
                            thinking: thinking || undefined,
                            usage
                        });
                        return;
                    }
                    
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        
                        // 检查 reasoning_content（DeepSeek 等）
                        if (isStreamThinkingEnabled(options) && delta?.reasoning_content) {
                            const normalized = normalizeStreamTextChunk(fullThinking, delta.reasoning_content);
                            fullThinking = normalized.fullText;
                            if (normalized.deltaText) this.emitThinking(normalized.deltaText);
                        }
                        
                        // 常规内容
                        if (delta?.content) {
                            fullContent += delta.content;
                            this.emitContent(delta.content);
                        }
                        
                        // 使用量统计
                        if (parsed.usage) {
                            usage = {
                                inputTokens: parsed.usage.prompt_tokens || 0,
                                outputTokens: parsed.usage.completion_tokens || 0
                            };
                        }
                    } catch {
                        // 忽略解析错误
                    }
                }
            });
            
            res.on('end', () => {
                if (!this.aborted && fullContent) {
                    const result = isStreamThinkingEnabled(options)
                        ? this.extractThinking(fullContent)
                        : { thinking: null, content: fullContent };
                    this.emitDone({
                        text: result.content,
                        thinking: isStreamThinkingEnabled(options) ? (fullThinking || result.thinking || undefined) : undefined,
                        usage
                    });
                }
            });
            
            res.on('error', (err: Error) => {
                this.emitError(err.message);
            });
        });
        
        req.on('error', (err: Error) => {
            this.emitError(`OpenRouter 请求失败: ${err.message}`);
        });
        
        req.on('timeout', () => {
            req.destroy();
            this.emitError('OpenRouter 响应超时');
        });
        
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.abort();
                req.destroy();
            });
        }
        
        req.write(requestBody);
        req.end();
    }
    
    private extractThinking(content: string): { thinking: string | null; content: string } {
        // 检查 <think> 标签
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            return {
                thinking: thinkMatch[1].trim(),
                content: content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
            };
        }
        return { thinking: null, content };
    }
}

// ==================== Google Gemini 流式适配器 ====================

export class GeminiStreamAdapter extends BaseStreamAdapter {
    private apiKey: string;
    
    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }
    
    async stream(
        model: ModelConfig | string,
        messages: StreamMessage[],
        options?: StreamOptions
    ): Promise<void> {
        this.aborted = false;
        
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(this.apiKey);
        
        const modelId = typeof model === 'string' 
            ? model 
            : (model.apiModelId || 'gemini-3-flash-preview');
        
        const geminiModel = genAI.getGenerativeModel({ model: modelId });
        
        // 转换消息格式
        const history = messages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: streamContentToGeminiParts(m.content)
        }));
        
        const lastMessage = messages[messages.length - 1];
        
        try {
            const chat = geminiModel.startChat({
                history,
                generationConfig: {
                    maxOutputTokens: resolveStreamMaxTokens(options),
                    temperature: options?.temperature ?? 0.7
                }
            });
            
            const result = await chat.sendMessageStream(streamContentToGeminiParts(lastMessage.content));
            
            let fullContent = '';
            
            for await (const chunk of result.stream) {
                if (this.aborted) break;
                
                const text = chunk.text();
                if (text) {
                    fullContent += text;
                    this.emitContent(text);
                }
            }
            
            if (!this.aborted) {
                this.emitDone({
                    text: fullContent,
                    usage: {
                        inputTokens: 0,
                        outputTokens: 0
                    }
                });
            }
        } catch (error: any) {
            this.emitError(error.message || 'Gemini 请求失败');
        }
    }
}

export class OpenAICompatibleStreamAdapter extends BaseStreamAdapter {
    private apiKey: string;
    private baseUrl: string;
    private providerName: string;

    constructor(apiKey: string, baseUrl: string, providerName: string) {
        super();
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.providerName = providerName;
    }

    stream(
        model: ModelConfig | string,
        messages: StreamMessage[],
        options?: StreamOptions
    ): void {
        this.aborted = false;

        const modelId = typeof model === 'string'
            ? model
            : (model.apiModelId || model.id);

        const maxTokens = resolveStreamMaxTokens(options);
        const isXiaomiMimo = /xiaomi\s*mimo/i.test(this.providerName);
        const thinkingParams = typeof model === 'string' && isXiaomiMimo && options?.thinkingEnabled === false
            ? { thinking: { type: 'disabled' } }
            : resolveStreamThinkingRequestParams(model, options);
        const requestBody = JSON.stringify({
            model: modelId,
            messages: messages.map(message => ({ role: message.role, content: streamContentToOpenAI(message.content) })),
            ...(isXiaomiMimo
                ? {
                    max_completion_tokens: maxTokens,
                    top_p: 0.95,
                    ...thinkingParams
                }
                : { max_tokens: maxTokens, ...resolveStreamThinkingRequestParams(model, options) }),
            temperature: options?.temperature ?? 0.7,
            stream: true
        });

        const endpoint = new URL('chat/completions', `${this.baseUrl}/`);
        const isHttps = endpoint.protocol === 'https:';
        const httpModule = isHttps ? require('https') : require('http');

        const req = httpModule.request({
            hostname: endpoint.hostname,
            port: endpoint.port || (isHttps ? 443 : 80),
            path: `${endpoint.pathname}${endpoint.search}`,
            method: 'POST',
            agent: getHttpRequestAgent(endpoint),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Length': Buffer.byteLength(requestBody)
            },
            timeout: 120000
        }, (res: any) => {
            const statusCode = Number(res.statusCode || 0);
            if (statusCode < 200 || statusCode >= 300) {
                attachHttpErrorResponseHandler(
                    res,
                    this.providerName,
                    statusCode,
                    (message) => this.emitError(message),
                    () => this.aborted
                );
                return;
            }

            let fullContent = '';
            let fullThinking = '';
            let buffer = '';
            let usage = { inputTokens: 0, outputTokens: 0 };

            res.on('data', (chunk: Buffer) => {
                if (this.aborted) return;

                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;

                    const data = line.slice(6).trim();
                    if (!data) continue;

                    if (data === '[DONE]') {
                        this.emitDone({
                            text: fullContent,
                            thinking: isStreamThinkingEnabled(options) ? (fullThinking || undefined) : undefined,
                            usage
                        });
                        return;
                    }

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;

                        if (isStreamThinkingEnabled(options) && delta?.reasoning_content) {
                            const normalized = normalizeStreamTextChunk(fullThinking, delta.reasoning_content);
                            fullThinking = normalized.fullText;
                            if (normalized.deltaText) this.emitThinking(normalized.deltaText);
                        }

                        if (typeof delta?.content === 'string' && delta.content) {
                            fullContent += delta.content;
                            this.emitContent(delta.content);
                        }

                        if (parsed.usage) {
                            usage = {
                                inputTokens: parsed.usage.prompt_tokens || 0,
                                outputTokens: parsed.usage.completion_tokens || 0
                            };
                        }
                    } catch {
                    }
                }
            });

            res.on('end', () => {
                if (!this.aborted) {
                    this.emitDone({
                        text: fullContent,
                        thinking: isStreamThinkingEnabled(options) ? (fullThinking || undefined) : undefined,
                        usage
                    });
                }
            });

            res.on('error', (err: Error) => {
                this.emitError(err.message);
            });
        });

        req.on('error', (err: Error) => {
            this.emitError(`${this.providerName} 请求失败: ${err.message}`);
        });

        req.on('timeout', () => {
            req.destroy();
            this.emitError(`${this.providerName} 响应超时`);
        });

        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.abort();
                req.destroy();
            });
        }

        req.write(requestBody);
        req.end();
    }
}

// ==================== 工厂函数 ====================

export interface StreamAdapterConfig {
    ollamaUrl?: string;
    ollamaApiKey?: string;
    openrouterApiKey?: string;
    googleApiKey?: string;
    xiaomiApiKey?: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
    gptsapiApiKey?: string;
    deepseekApiKey?: string;
}

/**
 * 创建适合模型的流式适配器
 */
export function createStreamAdapter(
    provider: string,
    config: StreamAdapterConfig
): BaseStreamAdapter {
    switch (provider) {
        case 'ollama':
            return new OllamaStreamAdapter(config.ollamaUrl || 'http://127.0.0.1:11434');
        case 'ollama-cloud':
            return new OllamaStreamAdapter(
                config.ollamaUrl || 'https://api.ollama.com',
                config.ollamaApiKey
            );
        case 'openrouter':
            if (!config.openrouterApiKey) {
                throw new Error('OpenRouter API key required');
            }
            return new OpenRouterStreamAdapter(config.openrouterApiKey);
        case 'google':
            if (!config.googleApiKey) {
                throw new Error('Google API key required');
            }
            return new GeminiStreamAdapter(config.googleApiKey);
        case 'xiaomi':
            if (!config.xiaomiApiKey) {
                throw new Error('Xiaomi MiMo API key required');
            }
            return new OpenAICompatibleStreamAdapter(config.xiaomiApiKey, 'https://api.xiaomimimo.com/v1', 'Xiaomi MiMo');
        case 'openai':
            if (!config.openaiApiKey) {
                throw new Error('OpenAI API key required');
            }
            return new OpenAICompatibleStreamAdapter(config.openaiApiKey, 'https://api.openai.com/v1', 'OpenAI');
        case 'gptsapi':
            if (!config.gptsapiApiKey) {
                throw new Error('GPTs API key required');
            }
            return new OpenAICompatibleStreamAdapter(config.gptsapiApiKey, 'https://api.gptsapi.net/v1', 'GPTs API');
        case 'deepseek':
            if (!config.deepseekApiKey) {
                throw new Error('DeepSeek API key required');
            }
            return new OpenAICompatibleStreamAdapter(
                config.deepseekApiKey,
                'https://api.deepseek.com',
                'DeepSeek'
            );
        default:
            throw new Error(`Unsupported provider for streaming: ${provider}`);
    }
}

// 类型已在定义处导出（export interface）
