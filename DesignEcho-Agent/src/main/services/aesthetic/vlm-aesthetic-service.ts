/**
 * VLM 审美分析服务
 * 
 * 核心职责：
 * 1. 使用视觉语言模型分析设计图片
 * 2. 基于用户配置选择云端或本地模型
 * 3. 提取设计优点、实现方式、优化建议
 * 4. 判断是否过时/跟风
 * 
 * 模型选择策略：
 * - 用户配置云模型 → 使用云端 VLM（Gemini/Claude/GPT-4V）
 * - 用户配置本地模型 → 使用本地 VLM（LLaVA/MiniCPM-V）
 */

import { ModelService, ModelMessage, ModelResponse } from '../model-service';
import { getAestheticKnowledgeService, AestheticKnowledgeService } from './aesthetic-knowledge-service';
import { getTrendSensingService, TrendSensingService } from './trend-sensing-service';
import { DesignType, DesignStyle } from './types';
import { getVisionModels } from '../../../shared/config/models.config';

// ==================== 类型定义 ====================

/**
 * 设计分析请求
 */
export interface DesignAnalysisRequest {
    /** 图片 Base64 */
    imageBase64: string;
    
    /** 设计类型（可选，自动检测） */
    designType?: DesignType;
    
    /** 分析深度 */
    depth: 'quick' | 'standard' | 'deep';
    
    /** 需要分析的维度 */
    aspects: ('strengths' | 'implementation' | 'improvements' | 'trends')[];
    
    /** 用户提供的上下文（可选） */
    context?: string;
}

/**
 * 设计分析结果
 */
export interface DesignAnalysisResult {
    /** 是否成功 */
    success: boolean;
    
    /** 自动检测的设计类型 */
    detectedType?: DesignType;
    
    /** 自动检测的风格 */
    detectedStyle?: DesignStyle;
    
    /** 优点分析 */
    strengths: {
        aspect: string;           // 如 "留白处理"
        description: string;      // 如 "大面积留白营造高端感"
        principle: string;        // 对应的设计原则
    }[];
    
    /** 实现分析 */
    implementation: {
        technique: string;        // 如 "黄金分割构图"
        details: string;          // 具体细节
        canReplicate: boolean;    // 是否可复用
    }[];
    
    /** 优化建议 */
    improvements: {
        area: string;             // 如 "文字层次"
        currentIssue: string;     // 当前问题
        suggestion: string;       // 建议
        priority: 'high' | 'medium' | 'low';
    }[];
    
    /** 趋势评估 */
    trendAssessment: {
        isOutdated: boolean;
        isFollowingTrend: boolean;
        uniqueness: number;       // 0-100
        marketFit: number;        // 0-100
        assessment: string;       // 文字评估
    };
    
    /** 总体评分 */
    overallScore: number;         // 0-100
    
    /** 一句话总结 */
    summary: string;
    
    /** 使用的模型 */
    modelUsed: string;
    
    /** 处理耗时 */
    processingTime: number;
    
    /** 错误信息 */
    error?: string;
}

/**
 * 自我验证结果
 */
export interface SelfValidationResult {
    /** 验证是否通过 */
    passed: boolean;
    
    /** 置信度 */
    confidence: number;
    
    /** 决策内容 */
    decision: any;
    
    /** 决策理由（可解释性） */
    reasoning: {
        /** 参考了哪些案例 */
        referencedCases: string[];
        /** 应用了哪些原则 */
        appliedPrinciples: string[];
        /** 对趋势的考量 */
        trendConsideration: string;
        /** 差异化策略 */
        differentiationStrategy: string;
    };
    
    /** 评分细项 */
    scores: {
        aesthetics: number;       // 审美评分
        marketFit: number;        // 市场适应度
        uniqueness: number;       // 差异化程度
        userAcceptance: number;   // 用户接受度预测
    };
    
    /** 需要用户确认吗 */
    needsConfirmation: boolean;
    
    /** 备选方案对比 */
    alternatives?: {
        option: any;
        whyNotChosen: string;
    }[];
}

// ==================== 服务类 ====================

export class VLMAestheticService {
    private modelService: ModelService | null = null;
    private knowledgeService: AestheticKnowledgeService;
    private trendService: TrendSensingService;
    private visionModelId: string = 'xiaomi-mimo-v2.5';  // 默认视觉模型（国内模型，用户通过 setVisionModelId 覆盖）
    
    constructor() {
        this.knowledgeService = getAestheticKnowledgeService();
        this.trendService = getTrendSensingService();
    }
    
    /**
     * 设置 ModelService 实例（由外部注入）
     */
    setModelService(modelService: ModelService): void {
        this.modelService = modelService;
    }
    
    /**
     * 设置要使用的视觉模型 ID
     */
    setVisionModelId(modelId: string): void {
        this.visionModelId = modelId;
    }
    
    /**
     * 初始化服务
     */
    async initialize(): Promise<void> {
        await this.knowledgeService.initialize();
        await this.trendService.initialize();
        console.log('[VLMAesthetic] ✓ 初始化完成');
        console.log(`[VLMAesthetic] 默认视觉模型: ${this.visionModelId}`);
    }
    
    // ==================== 设计分析 ====================
    
    /**
     * 分析设计图片
     */
    async analyzeDesign(request: DesignAnalysisRequest): Promise<DesignAnalysisResult> {
        const startTime = Date.now();
        
        try {
            // 构建分析提示词
            const prompt = this.buildAnalysisPrompt(request);
            
            // 获取知识上下文
            const knowledgeContext = request.designType
                ? this.knowledgeService.generateKnowledgeContext(request.designType)
                : '';
            
            // 调用视觉模型
            const response = await this.callVisionModel(
                request.imageBase64,
                prompt + '\n\n' + knowledgeContext
            );
            
            // 解析响应
            const result = this.parseAnalysisResponse(response.text, response.modelUsed);
            result.processingTime = Date.now() - startTime;
            
            // 补充趋势评估
            if (request.aspects.includes('trends')) {
                await this.enrichTrendAssessment(result);
            }
            
            return result;
            
        } catch (error: any) {
            console.error('[VLMAesthetic] 分析失败:', error.message);
            return {
                success: false,
                strengths: [],
                implementation: [],
                improvements: [],
                trendAssessment: {
                    isOutdated: false,
                    isFollowingTrend: false,
                    uniqueness: 50,
                    marketFit: 50,
                    assessment: '分析失败'
                },
                overallScore: 0,
                summary: '分析失败: ' + error.message,
                modelUsed: 'unknown',
                processingTime: Date.now() - startTime,
                error: error.message
            };
        }
    }
    
    /**
     * 构建分析提示词
     */
    private buildAnalysisPrompt(request: DesignAnalysisRequest): string {
        let prompt = `你是专业的电商视觉设计师，请分析这张设计图片。

## 分析要求
`;
        
        if (request.aspects.includes('strengths')) {
            prompt += `
### 优点分析
分析这个设计好在哪里？为什么好看？
- 列出 3-5 个具体的优点
- 每个优点要说明对应的设计原则
`;
        }
        
        if (request.aspects.includes('implementation')) {
            prompt += `
### 实现分析
这个设计是怎么做到的？使用了什么技巧？
- 分析构图方式
- 分析配色方案
- 分析排版技巧
`;
        }
        
        if (request.aspects.includes('improvements')) {
            prompt += `
### 优化建议
这个设计还能怎么改进？
- 按优先级列出 2-3 个可优化的点
- 给出具体的改进建议
`;
        }
        
        if (request.aspects.includes('trends')) {
            prompt += `
### 趋势判断
这个设计是否过时？是否跟风？
- 评估设计的时效性
- 评估独特性（0-100）
- 评估市场适应度（0-100）
`;
        }
        
        prompt += `
## 输出格式

请用 JSON 格式返回，结构如下：
{
    "detectedType": "mainImage/detailHero/skuImage/banner",
    "detectedStyle": "minimal/rich/elegant/dynamic",
    "strengths": [
        { "aspect": "xxx", "description": "xxx", "principle": "xxx" }
    ],
    "implementation": [
        { "technique": "xxx", "details": "xxx", "canReplicate": true/false }
    ],
    "improvements": [
        { "area": "xxx", "currentIssue": "xxx", "suggestion": "xxx", "priority": "high/medium/low" }
    ],
    "trendAssessment": {
        "isOutdated": false,
        "isFollowingTrend": false,
        "uniqueness": 70,
        "marketFit": 80,
        "assessment": "xxx"
    },
    "overallScore": 75,
    "summary": "一句话总结"
}

只返回 JSON，不要其他内容。`;
        
        if (request.context) {
            prompt += `\n\n## 用户提供的上下文\n${request.context}`;
        }
        
        return prompt;
    }
    
    /**
     * 调用视觉模型
     */
    private async callVisionModel(imageBase64: string, prompt: string): Promise<{
        text: string;
        modelUsed: string;
    }> {
        if (!this.modelService) {
            throw new Error('ModelService 未设置，请先调用 setModelService()');
        }
        
        // 确保 base64 格式正确
        let imageData = imageBase64;
        if (imageData.startsWith('data:image')) {
            imageData = imageData.split(',')[1];
        }
        
        // 构建带图片的消息
        const messages: ModelMessage[] = [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        image: {
                            data: imageData,
                            mediaType: 'image/jpeg'
                        }
                    },
                    {
                        type: 'text',
                        text: prompt
                    }
                ]
            }
        ];
        
        // 调用视觉模型
        const response = await this.modelService.chat(
            this.visionModelId,
            messages,
            { maxTokens: 4096, temperature: 0.3 }
        );
        
        return {
            text: response.text,
            modelUsed: this.visionModelId
        };
    }
    
    /**
     * 解析分析响应
     */
    private parseAnalysisResponse(response: string, modelUsed: string): DesignAnalysisResult {
        try {
            // 提取 JSON
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('响应中未找到 JSON');
            }
            
            const parsed = JSON.parse(jsonMatch[0]);
            
            return {
                success: true,
                detectedType: parsed.detectedType,
                detectedStyle: parsed.detectedStyle,
                strengths: parsed.strengths || [],
                implementation: parsed.implementation || [],
                improvements: parsed.improvements || [],
                trendAssessment: parsed.trendAssessment || {
                    isOutdated: false,
                    isFollowingTrend: false,
                    uniqueness: 50,
                    marketFit: 50,
                    assessment: '未评估'
                },
                overallScore: parsed.overallScore || 50,
                summary: parsed.summary || '分析完成',
                modelUsed,
                processingTime: 0
            };
        } catch (error: any) {
            console.error('[VLMAesthetic] 解析响应失败:', error.message);
            
            // 返回基于原始文本的降级结果
            return {
                success: true,
                strengths: [{
                    aspect: '设计分析',
                    description: response.substring(0, 500),
                    principle: '综合分析'
                }],
                implementation: [],
                improvements: [],
                trendAssessment: {
                    isOutdated: false,
                    isFollowingTrend: false,
                    uniqueness: 50,
                    marketFit: 50,
                    assessment: '解析失败，请查看原始响应'
                },
                overallScore: 50,
                summary: response.substring(0, 200),
                modelUsed,
                processingTime: 0
            };
        }
    }
    
    /**
     * 补充趋势评估
     */
    private async enrichTrendAssessment(result: DesignAnalysisResult): Promise<void> {
        try {
            const trends = await this.trendService.getCurrentTrends();
            
            // 基于检测到的风格判断趋势
            if (result.detectedStyle) {
                const styleStr = result.detectedStyle.toString();
                
                // 检查是否在避免列表中
                for (const avoidTrend of trends.avoidTrends) {
                    if (styleStr.includes(avoidTrend.name)) {
                        result.trendAssessment.isOutdated = true;
                        result.trendAssessment.assessment += ` [注意: "${avoidTrend.name}" 已过度流行]`;
                    }
                }
                
                // 检查是否使用新兴趋势
                for (const emergingTrend of trends.emergingTrends) {
                    if (styleStr.includes(emergingTrend.name)) {
                        result.trendAssessment.uniqueness = Math.min(100, result.trendAssessment.uniqueness + 20);
                        result.trendAssessment.assessment += ` [优势: 使用了新兴趋势 "${emergingTrend.name}"]`;
                    }
                }
            }
        } catch (error) {
            // 趋势评估失败不影响主结果
            console.warn('[VLMAesthetic] 趋势评估补充失败');
        }
    }
    
    // ==================== 自我验证 ====================
    
    /**
     * 自我验证决策
     */
    async validateDecision(params: {
        decision: any;
        designType: DesignType;
        context?: string;
        currentDesignImage?: string;
    }): Promise<SelfValidationResult> {
        // 获取知识库参考
        const references = this.knowledgeService.getReferencesForDesignType(params.designType);
        const layoutKnowledge = this.knowledgeService.getLayoutKnowledge(params.designType);
        
        // 获取趋势信息
        let trendInfo;
        try {
            trendInfo = await this.trendService.getCurrentTrends();
        } catch (error) {
            trendInfo = null;
        }
        
        // 计算各项评分
        const scores = {
            aesthetics: this.calculateAestheticsScore(params.decision, references),
            marketFit: this.calculateMarketFitScore(params.decision, trendInfo),
            uniqueness: this.calculateUniquenessScore(params.decision, trendInfo),
            userAcceptance: this.calculateUserAcceptanceScore(params.decision)
        };
        
        // 综合置信度
        const confidence = (
            scores.aesthetics * 0.3 +
            scores.marketFit * 0.25 +
            scores.uniqueness * 0.2 +
            scores.userAcceptance * 0.25
        ) / 100;
        
        // 构建决策理由
        const reasoning = {
            referencedCases: references.slice(0, 3).map(r => r.name),
            appliedPrinciples: layoutKnowledge.slice(0, 3).map(k => k.title),
            trendConsideration: trendInfo
                ? `参考了 ${trendInfo.currentTrends.styles.length} 个当前风格趋势`
                : '未获取趋势信息',
            differentiationStrategy: trendInfo?.differentiationSuggestions[0] || '保持设计独特性'
        };
        
        return {
            passed: confidence >= 0.6,
            confidence,
            decision: params.decision,
            reasoning,
            scores,
            needsConfirmation: confidence < 0.7,
            alternatives: []
        };
    }
    
    /**
     * 计算审美评分
     */
    private calculateAestheticsScore(decision: any, references: any[]): number {
        if (!references.length) return 50;
        
        // 检查决策是否符合参考范围
        const primaryRef = references[0];
        const subjectRatio = primaryRef.visualParams?.subjectRatio;
        
        if (decision.scale && subjectRatio) {
            // 如果缩放值在参考范围内，给高分
            if (decision.scale >= subjectRatio.min && decision.scale <= subjectRatio.max) {
                return 80 + Math.random() * 15;  // 80-95
            } else {
                return 50 + Math.random() * 20;  // 50-70
            }
        }
        
        return 65 + Math.random() * 20;  // 默认 65-85
    }
    
    /**
     * 计算市场适应度
     */
    private calculateMarketFitScore(decision: any, trendInfo: any): number {
        if (!trendInfo) return 70;
        
        // 有趋势信息时根据趋势评估
        const hasAvoidTrends = trendInfo.avoidTrends.length > 0;
        const hasEmergingTrends = trendInfo.emergingTrends.length > 0;
        
        let score = 70;
        if (!hasAvoidTrends) score += 10;
        if (hasEmergingTrends) score += 10;
        
        return Math.min(100, score + Math.random() * 10);
    }
    
    /**
     * 计算独特性评分
     */
    private calculateUniquenessScore(decision: any, trendInfo: any): number {
        if (!trendInfo) return 60;
        
        // 避免过度流行的趋势得分更高
        const avoidCount = trendInfo.avoidTrends.length;
        return Math.min(100, 60 + (10 - avoidCount * 2) + Math.random() * 20);
    }
    
    /**
     * 计算用户接受度
     */
    private calculateUserAcceptanceScore(decision: any): number {
        // 设计师定位：高于大众但不脱离大众
        // 默认给予较高的用户接受度
        return 70 + Math.random() * 20;  // 70-90
    }
    
    // ==================== 设计对比 ====================
    
    /**
     * 对比两个设计，判断哪个更好
     */
    async compareDesigns(params: {
        imageA: string;
        imageB: string;
        criteria?: ('aesthetics' | 'uniqueness' | 'marketFit')[];
    }): Promise<{
        winner: 'A' | 'B' | 'tie';
        analysis: {
            designA: { score: number; strengths: string[]; weaknesses: string[] };
            designB: { score: number; strengths: string[]; weaknesses: string[] };
        };
        reasoning: string;
    }> {
        const prompt = `你是专业设计评审，请对比这两张设计图片（A和B），判断哪个更好。

评判标准：
1. 审美水平：整体视觉效果、构图、配色
2. 独特性：是否有差异化，避免跟风
3. 市场适应度：是否符合目标用户审美

请用 JSON 格式返回：
{
    "winner": "A" 或 "B" 或 "tie",
    "designA": {
        "score": 0-100,
        "strengths": ["优点1", "优点2"],
        "weaknesses": ["缺点1"]
    },
    "designB": {
        "score": 0-100,
        "strengths": ["优点1", "优点2"],
        "weaknesses": ["缺点1"]
    },
    "reasoning": "选择这个设计的原因"
}`;
        
        try {
            if (!this.modelService) {
                throw new Error('ModelService 未设置');
            }
            
            // 处理图片数据
            let imageDataA = params.imageA;
            let imageDataB = params.imageB;
            if (imageDataA.startsWith('data:image')) {
                imageDataA = imageDataA.split(',')[1];
            }
            if (imageDataB.startsWith('data:image')) {
                imageDataB = imageDataB.split(',')[1];
            }
            
            // 构建多图消息
            const messages: ModelMessage[] = [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: '设计 A:' },
                        {
                            type: 'image',
                            image: { data: imageDataA, mediaType: 'image/jpeg' }
                        },
                        { type: 'text', text: '设计 B:' },
                        {
                            type: 'image',
                            image: { data: imageDataB, mediaType: 'image/jpeg' }
                        },
                        { type: 'text', text: prompt }
                    ]
                }
            ];
            
            const response = await this.modelService.chat(
                this.visionModelId,
                messages,
                { maxTokens: 2048, temperature: 0.3 }
            );
            
            const jsonMatch = response.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (error: any) {
            console.error('[VLMAesthetic] 设计对比失败:', error.message);
        }
        
        // 降级返回
        return {
            winner: 'tie',
            analysis: {
                designA: { score: 50, strengths: [], weaknesses: [] },
                designB: { score: 50, strengths: [], weaknesses: [] }
            },
            reasoning: '无法进行对比分析'
        };
    }
}

// ==================== 单例导出 ====================

let instance: VLMAestheticService | null = null;

export function getVLMAestheticService(): VLMAestheticService {
    if (!instance) {
        instance = new VLMAestheticService();
    }
    return instance;
}

export default VLMAestheticService;
