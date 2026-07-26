/**
 * Prompt-based Tool Call 解析器
 *
 * 给不支持原生 tool use 的本地模型使用
 * 从模型文本输出中提取 <tool_call> 标签
 */

import type { ToolCall, ToolSchema } from './types';

/**
 * 生成工具描述的系统提示注入
 */
export function buildToolSystemPrompt(tools: ToolSchema[]): string {
    const toolDescriptions = tools.map(t => {
        const propsStr = Object.entries(t.inputSchema.properties || {})
            .map(([key, schema]: [string, any]) => {
                const required = t.inputSchema.required?.includes(key) ? ' (required)' : '';
                return `    "${key}": ${schema.type || 'any'}${required} — ${schema.description || ''}`;
            })
            .join('\n');
        return `  - ${t.name}: ${t.description}\n    Parameters:\n${propsStr}`;
    }).join('\n\n');

    return `\n<tools>
You have access to the following tools. To call a tool, output a <tool_call> tag:

<tool_call>{"name": "tool_name", "arguments": {"param": "value"}}</tool_call>

You can call multiple tools in a single response. After all tool calls are executed, their results will be provided and you can continue.

Available tools:

${toolDescriptions}
</tools>`;
}

/**
 * 从文本中提取 tool_call 标签
 */
export function parseToolCallsFromText(text: string): { toolCalls: ToolCall[]; cleanedText: string } {
    const toolCalls: ToolCall[] = [];
    let callIndex = 0;

    // Match <tool_call>...</tool_call> tags
    const tagRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match;

    while ((match = tagRegex.exec(text)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            if (parsed.name) {
                toolCalls.push({
                    id: `prompt_call_${callIndex++}`,
                    name: parsed.name,
                    arguments: parsed.arguments || parsed.params || {}
                });
            }
        } catch (e) {
            // Try extracting name and arguments from malformed JSON
            try {
                const nameMatch = match[1].match(/"name"\s*:\s*"([^"]+)"/);
                const argsMatch = match[1].match(/"arguments"\s*:\s*(\{[\s\S]*\})/);
                if (nameMatch) {
                    toolCalls.push({
                        id: `prompt_call_${callIndex++}`,
                        name: nameMatch[1],
                        arguments: argsMatch ? JSON.parse(argsMatch[1]) : {}
                    });
                }
            } catch {
                console.warn('[PromptToolParser] Failed to parse tool_call:', match[1]);
            }
        }
    }

    // Remove tool_call tags from text
    const cleanedText = text
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return { toolCalls, cleanedText };
}
