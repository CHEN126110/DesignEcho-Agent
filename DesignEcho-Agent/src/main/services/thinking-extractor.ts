/**
 * 思维过程提取器
 * 
 * 统一处理不同模型返回的思维/推理过程，适配以下格式：
 * - extended_thinking: Claude Extended Thinking API
 * - reasoning_content: DeepSeek 风格
 * - think_tag: Qwen3 风格 (<think>...</think> 或 /think)
 * - xml_tag: 通用 XML 标签 (<thinking>...</thinking>)
 */

import { ThinkingFormat, ThinkingConfig } from '../../shared/config/models.config';

export interface ExtractedThinking {
    /** 思维过程内容 */
    thinking: string;
    /** 清理后的正文内容 */
    content: string;
}

/**
 * 从模型响应中提取思维过程
 */
export function extractThinking(
    rawResponse: any,
    format: ThinkingFormat
): ExtractedThinking {
    switch (format) {
        case 'extended_thinking':
            return extractClaudeThinking(rawResponse);
        case 'reasoning_content':
            return extractDeepSeekThinking(rawResponse);
        case 'think_tag':
            return extractQwen3Thinking(rawResponse);
        case 'xml_tag':
            return extractXmlThinking(rawResponse);
        case 'none':
        default:
            return { thinking: '', content: getTextContent(rawResponse) };
    }
}

/**
 * 从 Claude Extended Thinking 响应中提取
 * 
 * Claude 返回格式：
 * {
 *   content: [
 *     { type: 'thinking', thinking: '...' },
 *     { type: 'text', text: '...' }
 *   ]
 * }
 */
function extractClaudeThinking(response: any): ExtractedThinking {
    const contentBlocks = response?.content || [];
    
    let thinking = '';
    let content = '';
    
    for (const block of contentBlocks) {
        if (block.type === 'thinking' && block.thinking) {
            thinking = block.thinking;
        } else if (block.type === 'text' && block.text) {
            content = block.text;
        }
    }
    
    // 如果没有专门的 thinking block，尝试从 text 中解析 XML 标签
    if (!thinking && content) {
        const xmlResult = extractXmlThinking({ text: content });
        if (xmlResult.thinking) {
            return xmlResult;
        }
    }
    
    return { thinking, content };
}

/**
 * 从 DeepSeek 响应中提取 reasoning_content
 * 
 * DeepSeek 返回格式：
 * {
 *   choices: [{
 *     message: {
 *       content: '...',
 *       reasoning_content: '...'
 *     }
 *   }]
 * }
 */
function extractDeepSeekThinking(response: any): ExtractedThinking {
    const message = response?.choices?.[0]?.message || response?.message || response;
    
    const thinking = message?.reasoning_content || '';
    let content = message?.content || '';
    
    // DeepSeek 有时也用 XML 标签
    if (!thinking && content) {
        const xmlResult = extractXmlThinking({ text: content });
        if (xmlResult.thinking) {
            return xmlResult;
        }
    }
    
    return { thinking, content };
}

/**
 * 从 Qwen3 响应中提取 <think>...</think> 标签内容
 * 
 * Qwen3 使用 <think> 标签（不是 <thinking>）
 * 格式：
 * <think>
 * 这是我的思考过程...
 * </think>
 * 
 * 这是实际回复内容...
 */
function extractQwen3Thinking(response: any): ExtractedThinking {
    let text = getTextContent(response);
    let thinking = '';
    
    // Qwen3 使用 <think>...</think>
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    }
    
    // 也尝试匹配 /think 格式（某些 API 使用）
    if (!thinking) {
        const slashMatch = text.match(/\/think\s*([\s\S]*?)\/no_?think/i);
        if (slashMatch) {
            thinking = slashMatch[1].trim();
            text = text.replace(/\/think\s*[\s\S]*?\/no_?think\s*/gi, '').trim();
        }
    }
    
    return { thinking, content: text };
}

/**
 * 从通用 XML 标签中提取 <thinking>...</thinking>
 */
function extractXmlThinking(response: any): ExtractedThinking {
    let text = getTextContent(response);
    let thinking = '';
    
    // 匹配 <thinking>...</thinking>
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
    if (thinkingMatch) {
        thinking = thinkingMatch[1].trim();
        text = text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim();
    }
    
    // 也尝试匹配 <thought>...</thought>
    if (!thinking) {
        const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/);
        if (thoughtMatch) {
            thinking = thoughtMatch[1].trim();
            text = text.replace(/<thought>[\s\S]*?<\/thought>\s*/g, '').trim();
        }
    }
    
    // 也尝试匹配 <reasoning>...</reasoning>
    if (!thinking) {
        const reasoningMatch = text.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
        if (reasoningMatch) {
            thinking = reasoningMatch[1].trim();
            text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
        }
    }
    
    return { thinking, content: text };
}

/**
 * 从各种响应格式中获取纯文本内容
 */
function getTextContent(response: any): string {
    if (typeof response === 'string') {
        return response;
    }
    
    // OpenAI/OpenRouter 格式
    if (response?.choices?.[0]?.message?.content) {
        return response.choices[0].message.content;
    }
    
    // Ollama 格式
    if (response?.message?.content) {
        return response.message.content;
    }
    
    // 直接 text 字段
    if (response?.text) {
        return response.text;
    }
    
    // content 字段
    if (response?.content) {
        if (typeof response.content === 'string') {
            return response.content;
        }
        // Claude 数组格式
        if (Array.isArray(response.content)) {
            const textBlock = response.content.find((b: any) => b.type === 'text');
            return textBlock?.text || '';
        }
    }
    
    return '';
}

/**
 * 根据模型配置自动选择提取方法
 */
export function extractThinkingFromModel(
    rawResponse: any,
    thinkingConfig?: ThinkingConfig
): ExtractedThinking {
    if (!thinkingConfig || !thinkingConfig.supported) {
        // 不支持思维过程时，仍尝试解析 XML 标签作为兼容路径
        return extractXmlThinking(rawResponse);
    }
    
    return extractThinking(rawResponse, thinkingConfig.format);
}

/**
 * 获取请求思维过程需要的额外参数
 * 
 * 不同模型需要不同的参数来启用思维过程：
 * - Qwen3: { enable_thinking: true }
 * - DeepSeek: 默认启用
 * - Claude: 需要特定 API 调用
 */
export function getThinkingRequestParams(
    thinkingConfig?: ThinkingConfig
): Record<string, any> {
    if (!thinkingConfig?.supported) {
        return {};
    }
    
    return thinkingConfig.requestParams || {};
}
