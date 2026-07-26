/**
 * Ollama Provider Adapter
 *
 * 支持两种模式：
 * 1. 原生 tool use（llama3.1+, qwen2.5+ 等支持的模型）
 * 2. Prompt-based 兼容模式（注入 XML 工具描述，解析 <tool_call> 输出）
 */

import type {
    ProviderAdapter, ProviderResponse, ToolSchema,
    ToolCall, AdapterMessage, AdapterOptions
} from './types';
import { buildAgentProviderTokenBudget } from '../../../shared/agent-performance-policy';
import { buildToolSystemPrompt, parseToolCallsFromText } from './prompt-tool-parser';

/** 已知支持原生 tool use 的 Ollama 模型前缀 */
const NATIVE_TOOL_MODELS = [
    'llama3.1', 'llama3.2', 'llama3.3', 'llama4',
    'qwen2.5', 'qwen3',
    'mistral', 'mixtral',
    'command-r',
    'firefunction',
    'hermes3'
];

export class OllamaAdapter implements ProviderAdapter {
    private useNativeTools: boolean;

    constructor(modelName?: string) {
        this.useNativeTools = modelName
            ? NATIVE_TOOL_MODELS.some(prefix => modelName.toLowerCase().startsWith(prefix))
            : false;
    }

    supportsNativeTools(): boolean {
        return this.useNativeTools;
    }

    formatMessages(
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: AdapterOptions
    ): any {
        if (this.useNativeTools) {
            return this.formatNative(messages, tools, options);
        }
        return this.formatPromptBased(messages, tools, options);
    }

    parseResponse(raw: any): ProviderResponse {
        const result: ProviderResponse = {
            usage: {
                inputTokens: raw.prompt_eval_count || 0,
                outputTokens: raw.eval_count || 0
            }
        };

        const messageContent = raw.message?.content || '';

        // Check for native tool calls first
        if (raw.message?.tool_calls?.length) {
            result.toolCalls = raw.message.tool_calls.map((tc: any, i: number) => ({
                id: `ollama_call_${i}`,
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || {}
            }));
            result.content = messageContent;
            result.stopReason = 'tool_use';
            return result;
        }

        // Try prompt-based parsing
        if (messageContent.includes('<tool_call>')) {
            const { toolCalls, cleanedText } = parseToolCallsFromText(messageContent);
            if (toolCalls.length > 0) {
                result.toolCalls = toolCalls;
                result.content = cleanedText;
                result.stopReason = 'tool_use';
                return result;
            }
        }

        result.content = messageContent;
        result.toolCalls = []; // no tool calls found
        result.stopReason = 'end_turn';
        return result;
    }

    private formatNative(
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: AdapterOptions
    ): any {
        const ollamaTools = tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema
            }
        }));

        const ollamaMessages = this.convertMessages(messages, options);

        return {
            messages: ollamaMessages,
            tools: ollamaTools,
            stream: false,
            options: {
                num_predict: buildAgentProviderTokenBudget({ requestedMaxTokens: options?.maxTokens }).maxTokens,
                temperature: options?.temperature ?? 0.7
            }
        };
    }

    private formatPromptBased(
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: AdapterOptions
    ): any {
        const ollamaMessages = this.convertMessages(messages, options);

        if (!tools.length) {
            return {
                messages: ollamaMessages,
                stream: false,
                options: {
                    num_predict: buildAgentProviderTokenBudget({ requestedMaxTokens: options?.maxTokens }).maxTokens,
                    temperature: options?.temperature ?? 0.7
                }
            };
        }

        // Inject tool descriptions into system prompt
        const toolPrompt = buildToolSystemPrompt(tools);
        const systemIdx = ollamaMessages.findIndex((m: any) => m.role === 'system');
        if (systemIdx >= 0) {
            ollamaMessages[systemIdx].content += toolPrompt;
        } else {
            ollamaMessages.unshift({ role: 'system', content: toolPrompt });
        }

        return {
            messages: ollamaMessages,
            stream: false,
            options: {
                num_predict: buildAgentProviderTokenBudget({ requestedMaxTokens: options?.maxTokens }).maxTokens,
                temperature: options?.temperature ?? 0.7
            }
        };
    }

    private convertMessages(messages: AdapterMessage[], options?: AdapterOptions): any[] {
        const result: any[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                result.push({ role: 'system', content: msg.content || '' });
            } else if (msg.role === 'user') {
                if (msg.contentBlocks?.length) {
                    const images = msg.contentBlocks
                        .filter(b => b.type === 'image')
                        .map(b => b.data || '');
                    const text = msg.contentBlocks
                        .filter(b => b.type === 'text')
                        .map(b => b.text || '')
                        .join('\n') || msg.content || '';
                    result.push({ role: 'user', content: text, ...(images.length ? { images } : {}) });
                } else {
                    result.push({ role: 'user', content: msg.content || '' });
                }
            } else if (msg.role === 'assistant') {
                let content = msg.content || '';
                // For prompt-based: reconstruct tool_call tags from toolCalls
                if (!this.useNativeTools && msg.toolCalls?.length) {
                    for (const call of msg.toolCalls) {
                        content += `\n<tool_call>${JSON.stringify({ name: call.name, arguments: call.arguments })}</tool_call>`;
                    }
                }
                result.push({ role: 'assistant', content });
            } else if (msg.role === 'tool_result') {
                // Convert tool results to user message
                const parts = (msg.toolResults || []).map(r => {
                    const output = typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
                    return `[Tool Result: ${r.callId}]\n${r.success ? output : `Error: ${output}`}`;
                });
                result.push({ role: 'user', content: parts.join('\n\n') });
            }
        }

        // Inject system prompt if not present
        if (options?.systemPrompt && !result.some(m => m.role === 'system')) {
            result.unshift({ role: 'system', content: options.systemPrompt });
        }

        return result;
    }
}
