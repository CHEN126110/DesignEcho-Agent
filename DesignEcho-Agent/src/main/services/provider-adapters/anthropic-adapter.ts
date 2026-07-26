/**
 * Anthropic (Claude) Provider Adapter
 *
 * 使用原生 tool_use content blocks
 */

import type {
    ProviderAdapter, ProviderResponse, ToolSchema,
    ToolCall, AdapterMessage, AdapterOptions
} from './types';
import { buildAgentProviderTokenBudget } from '../../../shared/agent-performance-policy';

export class AnthropicAdapter implements ProviderAdapter {
    supportsNativeTools(): boolean {
        return true;
    }

    formatMessages(
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: AdapterOptions
    ): { system?: string; messages: any[]; tools?: any[]; max_tokens: number; temperature?: number } {
        // Convert tools to Anthropic format
        const anthropicTools = tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema
        }));

        // Convert messages to Anthropic format
        const anthropicMessages: any[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') continue; // system handled separately

            if (msg.role === 'user') {
                if (msg.contentBlocks?.length) {
                    const content = msg.contentBlocks.map(b =>
                        b.type === 'image'
                            ? { type: 'image', source: { type: 'base64', media_type: b.mediaType || 'image/jpeg', data: b.data || '' } }
                            : { type: 'text', text: b.text || '' }
                    );
                    anthropicMessages.push({ role: 'user', content });
                } else {
                    anthropicMessages.push({ role: 'user', content: msg.content || '' });
                }
            } else if (msg.role === 'assistant') {
                const content: any[] = [];
                if (msg.content) {
                    content.push({ type: 'text', text: msg.content });
                }
                if (msg.toolCalls?.length) {
                    for (const call of msg.toolCalls) {
                        content.push({
                            type: 'tool_use',
                            id: call.id,
                            name: call.name,
                            input: call.arguments
                        });
                    }
                }
                anthropicMessages.push({ role: 'assistant', content });
            } else if (msg.role === 'tool_result') {
                const content = (msg.toolResults || []).map(r => ({
                    type: 'tool_result' as const,
                    tool_use_id: r.callId,
                    content: typeof r.output === 'string' ? r.output : JSON.stringify(r.output),
                    is_error: !r.success
                }));
                anthropicMessages.push({ role: 'user', content });
            }
        }

        // Extract system prompt
        const systemMsg = messages.find(m => m.role === 'system');
        const system = options?.systemPrompt || systemMsg?.content;

        return {
            ...(system ? { system } : {}),
            messages: anthropicMessages,
            ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
            max_tokens: buildAgentProviderTokenBudget({ requestedMaxTokens: options?.maxTokens }).maxTokens,
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {})
        };
    }

    parseResponse(raw: any): ProviderResponse {
        const result: ProviderResponse = {
            usage: {
                inputTokens: raw.usage?.input_tokens || 0,
                outputTokens: raw.usage?.output_tokens || 0
            }
        };

        // Parse stop reason
        if (raw.stop_reason === 'tool_use') {
            result.stopReason = 'tool_use';
        } else if (raw.stop_reason === 'end_turn') {
            result.stopReason = 'end_turn';
        } else if (raw.stop_reason === 'max_tokens') {
            result.stopReason = 'max_tokens';
        }

        // Parse content blocks
        const contentBlocks = raw.content || [];
        const textParts: string[] = [];
        const toolCalls: ToolCall[] = [];

        for (const block of contentBlocks) {
            if (block.type === 'text') {
                textParts.push(block.text);
            } else if (block.type === 'thinking') {
                result.thinking = block.thinking;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    arguments: block.input || {}
                });
            }
        }

        result.content = textParts.join('');
        result.toolCalls = toolCalls; // always set (empty array if none)

        return result;
    }
}
