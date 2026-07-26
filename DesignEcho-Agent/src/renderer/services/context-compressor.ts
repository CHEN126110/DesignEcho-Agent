/**
 * 对话上下文压缩服务
 * 
 * 功能：
 * 1. 当对话历史超过阈值时，生成摘要替换旧历史
 * 2. 保留最近 N 条消息不压缩
 * 3. 支持自定义摘要提示词
 * 
 * 安全特性：
 * - 默认关闭，需显式启用
 * - 压缩失败时回退到原始消息
 * - 保留原始消息在内存中（可回滚）
 */

import { 
    estimateMessagesTokens, 
    getCompressionAdvice,
    formatTokenCount
} from './token-counter';

/**
 * 消息类型（兼容 Agent 消息格式）
 */
export interface Message {
    role: string;
    content: string;
}

/**
 * 压缩器配置
 */
export interface CompressorConfig {
    /** 是否启用压缩（默认 false） */
    enabled: boolean;
    
    /** 触发压缩的 token 阈值（默认 60000） */
    tokenThreshold: number;
    
    /** 保留最近 N 条消息不压缩（默认 4） */
    keepRecentMessages: number;
    
    /** 用于生成摘要的模型（可选，默认使用当前模型） */
    summaryModel?: string;
    
    /** 自定义摘要提示词（可选） */
    customSummaryPrompt?: string;
    
    /** 压缩后目标 token 数（默认 threshold * 0.3） */
    targetTokens?: number;
}

/**
 * 默认配置
 */
export const DEFAULT_COMPRESSOR_CONFIG: CompressorConfig = {
    enabled: false,  // 默认关闭
    tokenThreshold: 60000,
    keepRecentMessages: 4,
    targetTokens: 18000,  // 60000 * 0.3
};

/**
 * 压缩结果
 */
export interface CompressionResult {
    /** 是否执行了压缩 */
    compressed: boolean;
    
    /** 压缩后的消息 */
    messages: Message[];
    
    /** 压缩前 token 数 */
    originalTokens: number;
    
    /** 压缩后 token 数 */
    compressedTokens: number;
    
    /** 原始消息（用于回滚） */
    originalMessages?: Message[];
    
    /** 生成的摘要（如果压缩了） */
    summary?: string;
    
    /** 错误信息（如果失败） */
    error?: string;
}

/**
 * 模型调用函数类型
 */
export type CallModelFn = (
    messages: Array<{ role: string; content: string }>,
    options?: { maxTokens?: number; temperature?: number }
) => Promise<{ text?: string; thinking?: string }>;

/**
 * 默认摘要提示词
 */
const DEFAULT_SUMMARY_PROMPT = `你是一个专业的对话摘要助手。请将以下对话历史压缩为一个简洁的摘要，供 AI 助手在后续对话中参考。

摘要要求：
1. 保留关键信息：用户的核心需求、已完成的操作、重要决策
2. 保留上下文：当前项目状态、设计偏好、技术约束
3. 保留承诺：AI 已承诺要做的事情
4. 省略细节：具体的代码、冗长的解释、重复的确认
5. 使用简体中文
6. 控制在 500 字以内

请直接输出摘要内容，不需要额外的格式标记。`;

/**
 * 对话压缩服务
 */
export class ContextCompressor {
    private config: CompressorConfig;
    private originalMessages: Message[] = [];
    
    constructor(config: Partial<CompressorConfig> = {}) {
        this.config = { ...DEFAULT_COMPRESSOR_CONFIG, ...config };
    }
    
    /**
     * 更新配置
     */
    updateConfig(config: Partial<CompressorConfig>): void {
        this.config = { ...this.config, ...config };
    }
    
    /**
     * 获取当前配置
     */
    getConfig(): CompressorConfig {
        return { ...this.config };
    }
    
    /**
     * 检查是否需要压缩
     */
    shouldCompress(messages: Message[]): boolean {
        if (!this.config.enabled) return false;
        
        const tokens = estimateMessagesTokens(messages);
        return tokens > this.config.tokenThreshold;
    }
    
    /**
     * 获取压缩建议
     */
    getAdvice(messages: Message[]): {
        shouldCompress: boolean;
        currentTokens: string;
        threshold: string;
        message: string;
    } {
        const advice = getCompressionAdvice(messages, this.config.tokenThreshold);
        
        return {
            shouldCompress: this.config.enabled && advice.shouldCompress,
            currentTokens: formatTokenCount(advice.currentTokens),
            threshold: formatTokenCount(advice.threshold),
            message: advice.shouldCompress
                ? `对话已达 ${formatTokenCount(advice.currentTokens)} tokens，建议压缩`
                : `对话 ${formatTokenCount(advice.currentTokens)} / ${formatTokenCount(advice.threshold)} tokens`
        };
    }
    
    /**
     * 压缩对话历史
     * 
     * @param messages 原始消息
     * @param callModel 模型调用函数
     * @returns 压缩结果
     */
    async compress(
        messages: Message[],
        callModel: CallModelFn
    ): Promise<CompressionResult> {
        const originalTokens = estimateMessagesTokens(messages);
        
        // 如果未启用或不需要压缩，直接返回
        if (!this.config.enabled || originalTokens <= this.config.tokenThreshold) {
            return {
                compressed: false,
                messages,
                originalTokens,
                compressedTokens: originalTokens
            };
        }
        
        console.log(`[ContextCompressor] 开始压缩: ${formatTokenCount(originalTokens)} tokens`);
        
        // 保存原始消息（用于回滚）
        this.originalMessages = [...messages];
        
        try {
            // 分离要压缩的消息和要保留的消息
            const keepCount = this.config.keepRecentMessages;
            const messagesToCompress = messages.slice(0, -keepCount);
            const messagesToKeep = messages.slice(-keepCount);
            
            // 如果要压缩的消息太少，不值得压缩
            if (messagesToCompress.length < 4) {
                console.log('[ContextCompressor] 可压缩消息太少，跳过');
                return {
                    compressed: false,
                    messages,
                    originalTokens,
                    compressedTokens: originalTokens
                };
            }
            
            // 生成摘要
            const summary = await this.generateSummary(messagesToCompress, callModel);
            
            if (!summary) {
                console.warn('[ContextCompressor] 摘要生成失败，回退到原始消息');
                return {
                    compressed: false,
                    messages,
                    originalTokens,
                    compressedTokens: originalTokens,
                    error: '摘要生成失败'
                };
            }
            
            // 构建压缩后的消息
            const compressedMessages: Message[] = [
                {
                    role: 'assistant',
                    content: `[对话摘要]\n${summary}\n\n---\n以下是最近的对话：`
                },
                ...messagesToKeep
            ];
            
            const compressedTokens = estimateMessagesTokens(compressedMessages);
            
            console.log(`[ContextCompressor] 压缩完成: ${formatTokenCount(originalTokens)} → ${formatTokenCount(compressedTokens)} tokens`);
            
            return {
                compressed: true,
                messages: compressedMessages,
                originalTokens,
                compressedTokens,
                originalMessages: this.originalMessages,
                summary
            };
            
        } catch (error: any) {
            console.error('[ContextCompressor] 压缩失败:', error);
            return {
                compressed: false,
                messages,
                originalTokens,
                compressedTokens: originalTokens,
                error: error.message
            };
        }
    }
    
    /**
     * 生成对话摘要
     */
    private async generateSummary(
        messages: Message[],
        callModel: CallModelFn
    ): Promise<string | null> {
        // 格式化对话历史
        const conversationText = messages.map(m => {
            const role = m.role === 'user' ? '用户' : 'AI';
            const content = typeof m.content === 'string' 
                ? m.content 
                : JSON.stringify(m.content);
            // 截断过长的内容
            const truncated = content.length > 500 
                ? content.substring(0, 500) + '...[截断]' 
                : content;
            return `${role}: ${truncated}`;
        }).join('\n\n');
        
        const prompt = this.config.customSummaryPrompt || DEFAULT_SUMMARY_PROMPT;
        
        const summaryRequest: Message[] = [
            { role: 'system', content: prompt },
            { role: 'user', content: `请为以下对话生成摘要：\n\n${conversationText}` }
        ];
        
        try {
            const response = await callModel(summaryRequest, { 
                maxTokens: 1024,
                temperature: 0.3
            });
            
            return response.text || null;
        } catch (error) {
            console.error('[ContextCompressor] 生成摘要失败:', error);
            return null;
        }
    }
    
    /**
     * 回滚到原始消息
     */
    rollback(): Message[] | null {
        if (this.originalMessages.length === 0) {
            return null;
        }
        return [...this.originalMessages];
    }
    
    /**
     * 清除保存的原始消息
     */
    clearOriginal(): void {
        this.originalMessages = [];
    }
}

/**
 * 单例实例
 */
let compressorInstance: ContextCompressor | null = null;

/**
 * 获取压缩器单例
 */
export function getContextCompressor(): ContextCompressor {
    if (!compressorInstance) {
        compressorInstance = new ContextCompressor();
    }
    return compressorInstance;
}

/**
 * 初始化压缩器（带配置）
 */
export function initContextCompressor(config: Partial<CompressorConfig>): ContextCompressor {
    compressorInstance = new ContextCompressor(config);
    return compressorInstance;
}
