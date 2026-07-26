/**
 * Token 计数器服务
 * 
 * 用于估算消息的 token 数量，支持对话压缩决策。
 * 
 * 算法说明：
 * - 中文：约 1.5-2 字符/token
 * - 英文：约 4 字符/token
 * - 代码/JSON：约 3 字符/token
 * - 混合内容：加权平均
 * 
 * 注意：这是估算值，实际 token 数会因模型而异。
 * 保守估算（偏高）以确保不超出上下文限制。
 */

export interface TokenEstimate {
    tokens: number;
    breakdown: {
        chinese: number;
        english: number;
        code: number;
        other: number;
    };
}

/**
 * 检测文本中的中文字符比例
 */
function getChineseRatio(text: string): number {
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
    return chineseChars ? chineseChars.length / text.length : 0;
}

/**
 * 检测文本是否主要是代码/JSON
 */
function isCodeLike(text: string): boolean {
    // 检测常见代码特征
    const codePatterns = [
        /^```/m,                    // Markdown 代码块
        /^\s*[\[{]/,                // JSON 开头
        /function\s+\w+/,           // 函数定义
        /=>/,                       // 箭头函数
        /import\s+.*from/,          // ES import
        /const\s+\w+\s*=/,          // 变量声明
    ];
    return codePatterns.some(p => p.test(text));
}

/**
 * 估算单个文本的 token 数
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    
    const chineseRatio = getChineseRatio(text);
    const isCode = isCodeLike(text);
    
    // 基础字符数
    const charCount = text.length;
    
    // 根据内容类型选择不同的转换系数
    if (isCode) {
        // 代码：约 3 字符/token
        return Math.ceil(charCount / 3);
    }
    
    if (chineseRatio > 0.3) {
        // 中文为主：约 1.8 字符/token（保守估算）
        const chineseChars = charCount * chineseRatio;
        const otherChars = charCount * (1 - chineseRatio);
        return Math.ceil(chineseChars / 1.8 + otherChars / 4);
    }
    
    // 英文为主：约 4 字符/token
    return Math.ceil(charCount / 4);
}

/**
 * 估算单个文本的 token 数（带详细分解）
 */
export function estimateTokensDetailed(text: string): TokenEstimate {
    if (!text) {
        return {
            tokens: 0,
            breakdown: { chinese: 0, english: 0, code: 0, other: 0 }
        };
    }
    
    // 分离中文和非中文
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
    const nonChinese = text.replace(/[\u4e00-\u9fa5]/g, '');
    
    // 检测代码块
    const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
    const codeLength = codeBlocks.reduce((sum, block) => sum + block.length, 0);
    
    // 计算各部分 token
    const chineseTokens = Math.ceil(chineseChars.length / 1.8);
    const codeTokens = Math.ceil(codeLength / 3);
    const englishTokens = Math.ceil((nonChinese.length - codeLength) / 4);
    
    return {
        tokens: chineseTokens + codeTokens + englishTokens,
        breakdown: {
            chinese: chineseTokens,
            english: englishTokens,
            code: codeTokens,
            other: 0
        }
    };
}

/**
 * 消息格式（与 Agent 兼容）
 */
export interface Message {
    role: string;
    content: string | any[];
}

/**
 * 估算消息数组的总 token 数
 */
export function estimateMessagesTokens(messages: Message[]): number {
    let total = 0;
    
    for (const msg of messages) {
        // 角色标记：约 4 tokens
        total += 4;
        
        // 内容
        if (typeof msg.content === 'string') {
            total += estimateTokens(msg.content);
        } else if (Array.isArray(msg.content)) {
            // 多模态内容
            for (const part of msg.content) {
                if (part.type === 'text') {
                    total += estimateTokens(part.text || '');
                } else if (part.type === 'image') {
                    // 图片：根据分辨率估算，一般 765-1105 tokens
                    total += 1000;
                }
            }
        }
    }
    
    return total;
}

/**
 * 检查是否需要压缩
 */
export function shouldCompress(messages: Message[], threshold: number = 60000): boolean {
    const tokens = estimateMessagesTokens(messages);
    return tokens > threshold;
}

/**
 * 获取压缩建议
 */
export interface CompressionAdvice {
    shouldCompress: boolean;
    currentTokens: number;
    threshold: number;
    excessTokens: number;
    suggestedMessagesToDrop: number;
}

export function getCompressionAdvice(
    messages: Message[], 
    threshold: number = 60000
): CompressionAdvice {
    const currentTokens = estimateMessagesTokens(messages);
    const shouldCompressNow = currentTokens > threshold;
    const excessTokens = Math.max(0, currentTokens - threshold);
    
    // 估算需要丢弃多少条消息
    let tokensToDrop = excessTokens + 10000; // 额外留 10k 缓冲
    let suggestedMessagesToDrop = 0;
    let droppedTokens = 0;
    
    // 从最旧的消息开始计算
    for (let i = 0; i < messages.length && droppedTokens < tokensToDrop; i++) {
        const msg = messages[i];
        droppedTokens += estimateTokens(
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        ) + 4;
        suggestedMessagesToDrop++;
    }
    
    return {
        shouldCompress: shouldCompressNow,
        currentTokens,
        threshold,
        excessTokens,
        suggestedMessagesToDrop
    };
}

/**
 * 格式化 token 数为可读字符串
 */
export function formatTokenCount(tokens: number): string {
    if (tokens < 1000) {
        return `${tokens}`;
    } else if (tokens < 1000000) {
        return `${(tokens / 1000).toFixed(1)}k`;
    } else {
        return `${(tokens / 1000000).toFixed(2)}M`;
    }
}
