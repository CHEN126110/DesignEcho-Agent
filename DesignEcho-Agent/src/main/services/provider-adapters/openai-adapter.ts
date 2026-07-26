/**
 * OpenAI / OpenRouter Provider Adapter
 *
 * 使用原生 function calling (tool_choice)
 * 兼容 OpenRouter 的 OpenAI 兼容 API
 */

import type {
    ProviderAdapter, ProviderResponse, ToolSchema,
    ToolCall, AdapterMessage, AdapterOptions
} from './types';
import { buildAgentProviderTokenBudget } from '../../../shared/agent-performance-policy';
import { normalizeProviderNativeToolCitations } from '../../../shared/provider-native-tools';

export class OpenAIAdapter implements ProviderAdapter {
    constructor(private readonly provider = 'openai') {}

    supportsNativeTools(): boolean {
        return true;
    }

    formatMessages(
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: AdapterOptions
    ): { messages: any[]; tools?: any[]; tool_choice?: string; max_tokens?: number; max_completion_tokens?: number; temperature?: number; top_p?: number; thinking?: Record<string, any> } & Record<string, any> {
        // Convert tools to OpenAI function calling format
        const openaiTools = tools.map(t => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema
            }
        }));
        const nativeTools = Array.isArray(options?.nativeTools) ? options.nativeTools : [];
        const requestTools = [...openaiTools, ...nativeTools];

        // Convert messages
        const openaiMessages: any[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                openaiMessages.push({ role: 'system', content: msg.content || '' });
            } else if (msg.role === 'user') {
                if (msg.contentBlocks?.length) {
                    const content = msg.contentBlocks.map(b =>
                        b.type === 'image'
                            ? { type: 'image_url', image_url: { url: `data:${b.mediaType || 'image/jpeg'};base64,${b.data || ''}` } }
                            : { type: 'text', text: b.text || '' }
                    );
                    openaiMessages.push({ role: 'user', content });
                } else {
                    openaiMessages.push({ role: 'user', content: msg.content || '' });
                }
            } else if (msg.role === 'assistant') {
                const assistantMsg: any = { role: 'assistant' };
                if (msg.content) {
                    assistantMsg.content = msg.content;
                }
                if (msg.toolCalls?.length) {
                    assistantMsg.tool_calls = msg.toolCalls.map((call, idx) => ({
                        id: call.id || `call_${idx}_${Date.now()}`,
                        type: 'function',
                        function: {
                            name: call.name,
                            arguments: JSON.stringify(call.arguments)
                        }
                    }));
                }
                // 思考模式 + 工具调用：DeepSeek/小米要求后续轮次原样回传 reasoning_content，OpenRouter 用 reasoning。
                // 仅在本次开启思考且历史确有 reasoning 时回写（首轮无历史 reasoning 不写，避免塞空字段触发校验）；
                // openai/gptsapi 原生不吃这两个字段，不回写以免被拒。
                if (options?.thinkingEnabled && msg.reasoningContent) {
                    if (this.provider === 'deepseek' || this.provider === 'xiaomi') {
                        assistantMsg.reasoning_content = msg.reasoningContent;
                    } else if (this.provider === 'openrouter') {
                        assistantMsg.reasoning = msg.reasoningContent;
                    }
                }
                openaiMessages.push(assistantMsg);
            } else if (msg.role === 'tool_result') {
                for (const r of msg.toolResults || []) {
                    openaiMessages.push({
                        role: 'tool',
                        tool_call_id: r.callId || `call_missing_${Date.now()}`,
                        content: typeof r.output === 'string' ? r.output : JSON.stringify(r.output)
                    });
                }
            }
        }

        // Inject system prompt if not already present
        if (options?.systemPrompt && !openaiMessages.some(m => m.role === 'system')) {
            openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
        }

        const maxCompletionTokens = buildAgentProviderTokenBudget({ requestedMaxTokens: options?.maxTokens }).maxTokens;
        const formatted: { messages: any[]; tools?: any[]; tool_choice?: string; max_tokens?: number; max_completion_tokens?: number; temperature?: number; top_p?: number; thinking?: Record<string, any> } & Record<string, any> = {
            messages: openaiMessages,
            ...(requestTools.length > 0 ? {
                tools: requestTools,
                tool_choice: 'auto' as const
            } : {}),
            max_tokens: maxCompletionTokens,
            ...(options?.thinkingEnabled === true ? (options.thinkingRequestParams || {}) : {}),
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {})
        };

        if (this.provider === 'xiaomi') {
            delete formatted.max_tokens;
            formatted.max_completion_tokens = maxCompletionTokens;
            formatted.temperature = formatted.temperature ?? 1.0;
            formatted.top_p = 0.95;
        }

        // xiaomi / deepseek：只有调用方明确关闭思考时才下发 disabled。
        // undefined 表示使用上层默认偏好；不要在 adapter 里按 provider 名把思考静默关掉。
        if ((this.provider === 'xiaomi' || this.provider === 'deepseek') && options?.thinkingEnabled === false) {
            formatted.thinking = { type: 'disabled' };
        }

        return formatted;
    }

    parseResponse(raw: any): ProviderResponse {
        const result: ProviderResponse = {};

        // Handle OpenAI chat completion format
        const choice = raw.choices?.[0];
        if (!choice) {
            result.content = '';
            return result;
        }

        const message = choice.message;
        result.content = message?.content || '';

        // Parse tool calls — always set toolCalls (empty array if none)
        if (message?.tool_calls?.length) {
            result.toolCalls = message.tool_calls.map((tc: any) => ({
                id: tc.id,
                name: tc.function?.name || '',
                arguments: safeParse(tc.function?.arguments)
            }));
            result.stopReason = 'tool_use';
        } else {
            result.toolCalls = [];
            if (choice.finish_reason === 'stop') {
                result.stopReason = 'end_turn';
            } else if (choice.finish_reason === 'length') {
                result.stopReason = 'max_tokens';
            }
        }

        // Extract reasoning：deepseek/小米用 reasoning_content，openrouter 用 reasoning（格式可能非字符串）。
        // 统一收进 result.thinking（既供 UI 展示，也供 agent 写回历史，下一轮回传满足 DeepSeek/小米要求）。
        const rawReasoning = message?.reasoning_content ?? message?.reasoning;
        if (rawReasoning != null) {
            const reasoningText = typeof rawReasoning === 'string' ? rawReasoning : JSON.stringify(rawReasoning);
            if (reasoningText) {
                result.thinking = reasoningText;
            }
        }

        if (this.provider === 'xiaomi') {
            result.citations = normalizeProviderNativeToolCitations(message?.annotations, {
                provider: 'xiaomi'
            });
            if (raw.usage?.web_search_usage) {
                result.nativeToolUsage = [
                    {
                        provider: 'xiaomi',
                        toolType: 'web_search',
                        rawUsage: raw.usage.web_search_usage
                    }
                ];
            }
        }

        // Usage
        result.usage = {
            inputTokens: raw.usage?.prompt_tokens || 0,
            outputTokens: raw.usage?.completion_tokens || 0
        };

        return result;
    }
}

function safeParse(jsonStr: any): Record<string, any> {
    if (typeof jsonStr === 'object' && jsonStr !== null) return jsonStr;
    if (typeof jsonStr !== 'string') return {};
    try {
        return JSON.parse(jsonStr);
    } catch {
        return {};
    }
}
