/**
 * Google Gemini Provider Adapter
 *
 * 使用原生 functionDeclarations
 */

import type {
    ProviderAdapter, ProviderResponse, ToolSchema,
    ToolCall, AdapterMessage, AdapterOptions
} from './types';
import { buildAgentProviderTokenBudget } from '../../../shared/agent-performance-policy';

export class GeminiAdapter implements ProviderAdapter {
    supportsNativeTools(): boolean {
        return true;
    }

    formatMessages(
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: AdapterOptions
    ): { contents: any[]; tools?: any[]; toolConfig?: any; systemInstruction?: any; generationConfig: any } {
        // Convert tools to Gemini functionDeclarations format
        const geminiTools = [{
            functionDeclarations: tools.map(t => ({
                name: t.name,
                description: t.description,
                parameters: convertToGeminiSchema(t.inputSchema)
            }))
        }];

        // Convert messages to Gemini contents format
        const contents: any[] = [];
        let systemInstruction: any = undefined;

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemInstruction = { parts: [{ text: msg.content || '' }] };
                continue;
            }

            if (msg.role === 'user') {
                const parts: any[] = msg.contentBlocks?.length
                    ? msg.contentBlocks.map(b =>
                        b.type === 'image'
                            ? { inlineData: { mimeType: b.mediaType || 'image/jpeg', data: b.data || '' } }
                            : { text: b.text || '' }
                    )
                    : [{ text: msg.content || '' }];
                contents.push({ role: 'user', parts });
            } else if (msg.role === 'assistant') {
                const parts: any[] = [];
                if (msg.content) {
                    parts.push({ text: msg.content });
                }
                if (msg.toolCalls?.length) {
                    for (const call of msg.toolCalls) {
                        parts.push({
                            functionCall: {
                                name: call.name,
                                args: call.arguments
                            }
                        });
                    }
                }
                contents.push({ role: 'model', parts });
            } else if (msg.role === 'tool_result') {
                // Gemini requires the actual function name in functionResponse.
                // We need to find the matching assistant message to resolve callId → function name.
                const prevAssistant = [...contents].reverse().find(c => c.role === 'model');
                const callIdToName: Record<string, string> = {};
                if (prevAssistant?.parts) {
                    for (const p of prevAssistant.parts) {
                        if (p.functionCall) {
                            // Match by position — Gemini call IDs are synthetic (gemini_call_0, etc.)
                            const idx = prevAssistant.parts.filter((pp: any) => pp.functionCall).indexOf(p);
                            callIdToName[`gemini_call_${idx}`] = p.functionCall.name;
                        }
                    }
                }
                const parts = (msg.toolResults || []).map(r => ({
                    functionResponse: {
                        name: callIdToName[r.callId] || r.callId,
                        response: { result: r.output }
                    }
                }));
                contents.push({ role: 'user', parts });
            }
        }

        // Inject system prompt
        if (options?.systemPrompt && !systemInstruction) {
            systemInstruction = { parts: [{ text: options.systemPrompt }] };
        }

        return {
            contents,
            ...(tools.length > 0
                ? {
                    tools: geminiTools,
                    toolConfig: {
                        functionCallingConfig: { mode: 'AUTO' }
                    }
                }
                : {}),
            ...(systemInstruction ? { systemInstruction } : {}),
            generationConfig: {
                maxOutputTokens: buildAgentProviderTokenBudget({ requestedMaxTokens: options?.maxTokens }).maxTokens,
                ...(options?.temperature !== undefined ? { temperature: options.temperature } : {})
            }
        };
    }

    parseResponse(raw: any): ProviderResponse {
        const result: ProviderResponse = {};

        // Gemini response format
        const candidate = raw.candidates?.[0];
        if (!candidate) {
            result.content = '';
            return result;
        }

        const parts = candidate.content?.parts || [];
        const textParts: string[] = [];
        const toolCalls: ToolCall[] = [];
        let callIndex = 0;

        for (const part of parts) {
            if (part.text) {
                textParts.push(part.text);
            } else if (part.functionCall) {
                toolCalls.push({
                    id: `gemini_call_${callIndex++}`,
                    name: part.functionCall.name,
                    arguments: part.functionCall.args || {}
                });
            }
        }

        result.content = textParts.join('');
        result.toolCalls = toolCalls; // always set (empty array if none)
        result.stopReason = toolCalls.length > 0 ? 'tool_use' : 'end_turn';

        // Usage
        result.usage = {
            inputTokens: raw.usageMetadata?.promptTokenCount || 0,
            outputTokens: raw.usageMetadata?.candidatesTokenCount || 0
        };

        return result;
    }
}

/**
 * Convert JSON Schema to Gemini-compatible schema
 * Gemini doesn't support some JSON Schema features
 */
function convertToGeminiSchema(schema: any): any {
    if (!schema) return { type: 'OBJECT', properties: {} };

    const result: any = {};

    if (schema.type === 'object') {
        result.type = 'OBJECT';
        if (schema.properties && Object.keys(schema.properties).length > 0) {
            result.properties = {};
            for (const [key, value] of Object.entries(schema.properties)) {
                result.properties[key] = convertToGeminiSchema(value);
            }
        } else {
            // Gemini requires properties on OBJECT — use empty properties
            result.properties = {};
        }
        if (schema.required?.length) {
            result.required = schema.required;
        }
    } else if (schema.type === 'array') {
        result.type = 'ARRAY';
        if (schema.items) {
            result.items = convertToGeminiSchema(schema.items);
        }
    } else if (schema.type === 'string') {
        result.type = 'STRING';
        if (schema.enum) result.enum = schema.enum;
        if (schema.description) result.description = schema.description;
    } else if (schema.type === 'number' || schema.type === 'integer') {
        result.type = schema.type === 'integer' ? 'INTEGER' : 'NUMBER';
        if (schema.description) result.description = schema.description;
    } else if (schema.type === 'boolean') {
        result.type = 'BOOLEAN';
        if (schema.description) result.description = schema.description;
    } else {
        result.type = 'STRING';
    }

    if (schema.description && !result.description) {
        result.description = schema.description;
    }

    return result;
}
