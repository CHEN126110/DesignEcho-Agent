/**
 * Provider Adapter 工厂
 */

export type { ProviderAdapter, ToolSchema, ToolCall, ProviderResponse, AdapterMessage, AdapterOptions, ToolResultEntry } from './types';

import type { ProviderAdapter } from './types';
import { AnthropicAdapter } from './anthropic-adapter';
import { OpenAIAdapter } from './openai-adapter';
import { GeminiAdapter } from './gemini-adapter';
import { OllamaAdapter } from './ollama-adapter';

/**
 * 获取对应提供商的 Adapter
 *
 * @param provider 提供商名称
 * @param modelName 可选的模型名（用于 Ollama 判断是否支持原生 tools）
 */
export function getProviderAdapter(provider: string, modelName?: string): ProviderAdapter {
    switch (provider) {
        case 'anthropic':
            return new AnthropicAdapter();
        case 'openai':
        case 'xiaomi':
        case 'gptsapi':
        case 'deepseek':
        case 'openrouter':
            return new OpenAIAdapter(provider);
        case 'google':
            return new GeminiAdapter();
        case 'ollama':
        case 'ollama-cloud':
            return new OllamaAdapter(modelName);
        default:
            // Default to prompt-based Ollama adapter
            return new OllamaAdapter(modelName);
    }
}
