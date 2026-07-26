/**
 * AI 审美决策服务
 * 
 * 核心职责：
 * 1. 接收设计任务请求
 * 2. 从审美知识库获取上下文
 * 3. 调用 LLM 进行审美决策
 * 4. 返回高置信度的执行参数
 * 
 * 设计理念：
 * - 高置信度时直接执行
 * - 低置信度时提供备选方案
 * - 学习用户反馈优化决策
 */

import {
    AestheticDecisionRequest,
    AestheticDecisionResult,
    DesignType,
    AestheticReference
} from './types';
import { getAestheticKnowledgeService, AestheticKnowledgeService } from './aesthetic-knowledge-service';

// ==================== 配置 ====================

interface DecisionConfig {
    /** 高置信度阈值（超过此值直接执行） */
    highConfidenceThreshold: number;
    /** 低置信度阈值（低于此值需要用户确认） */
    lowConfidenceThreshold: number;
    /** 是否启用快速模式（跳过 LLM 调用，使用规则） */
    fastMode: boolean;
}

const DEFAULT_CONFIG: DecisionConfig = {
    highConfidenceThreshold: 0.8,
    lowConfidenceThreshold: 0.5,
    fastMode: false
};

// ==================== 服务类 ====================

export class AestheticDecisionService {
    private knowledgeService: AestheticKnowledgeService;
    private config: DecisionConfig;
    private llmCall?: (prompt: string) => Promise<string>;
    
    constructor(config?: Partial<DecisionConfig>) {
        this.knowledgeService = getAestheticKnowledgeService();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    
    /**
     * 设置 LLM 调用函数
     */
    setLLMProvider(llmCall: (prompt: string) => Promise<string>): void {
        this.llmCall = llmCall;
    }
    
    /**
     * 核心方法：做出审美决策
     */
    async makeDecision(request: AestheticDecisionRequest): Promise<AestheticDecisionResult> {
        const startTime = Date.now();
        
        // 快速模式：使用规则引擎
        if (this.config.fastMode || !this.llmCall) {
            return this.makeRuleBasedDecision(request, startTime);
        }
        
        // AI 模式：使用 LLM
        return this.makeAIDecision(request, startTime);
    }
    
    /**
     * 规则引擎决策（快速，中等置信度）
     */
    private makeRuleBasedDecision(
        request: AestheticDecisionRequest,
        startTime: number
    ): AestheticDecisionResult {
        const { canvas, asset, designType } = request;
        
        // 获取最匹配的审美参考
        const references = this.knowledgeService.getReferencesForDesignType(
            designType,
            request.preferredStyle
        );
        
        const primaryRef = references[0] || this.getDefaultReference(designType);
        
        // 计算目标尺寸
        const idealRatio = primaryRef.visualParams.subjectRatio.ideal;
        const targetHeight = canvas.height * idealRatio;
        
        // 计算缩放比例
        // 如果有主体边界，基于主体计算；否则基于整个素材
        let subjectHeight = asset.height;
        if (asset.subjectBounds) {
            subjectHeight = asset.subjectBounds.height;
        }
        const scale = targetHeight / subjectHeight;
        
        // 计算位置
        const position = this.calculatePosition(
            canvas,
            asset,
            scale,
            primaryRef.visualParams.position
        );
        
        return {
            success: true,
            confidence: 0.7,  // 规则引擎固定置信度
            scale,
            position: {
                x: position.x,
                y: position.y,
                anchor: 'center'
            },
            reason: `基于「${primaryRef.name}」参考，主体占画布 ${Math.round(idealRatio * 100)}%`,
            referencedKnowledge: [primaryRef.id],
            processingTime: Date.now() - startTime
        };
    }
    
    /**
     * AI 决策（慢速，高置信度）
     */
    private async makeAIDecision(
        request: AestheticDecisionRequest,
        startTime: number
    ): Promise<AestheticDecisionResult> {
        const { canvas, asset, designType, userIntent } = request;
        
        // 计算素材的主体占比
        let subjectRatio: number | undefined;
        if (asset.subjectBounds) {
            subjectRatio = (asset.subjectBounds.width * asset.subjectBounds.height) / 
                           (asset.width * asset.height);
        }
        
        // 生成决策提示词
        const prompt = this.knowledgeService.generateDecisionPrompt(
            designType,
            { width: canvas.width, height: canvas.height },
            { 
                width: asset.width, 
                height: asset.height,
                subjectRatio 
            },
            userIntent
        );
        
        try {
            // 调用 LLM
            const response = await this.llmCall!(prompt);
            
            // 解析响应
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('LLM 响应格式错误');
            }
            
            const decision = JSON.parse(jsonMatch[0]);
            
            // 验证决策合理性
            const validated = this.validateDecision(decision, canvas, asset);
            
            // 获取使用的知识引用
            const references = this.knowledgeService.getReferencesForDesignType(designType);
            const referencedKnowledge = references.slice(0, 3).map(r => r.id);
            
            return {
                success: true,
                confidence: validated.confidence,
                scale: validated.scale,
                position: {
                    x: validated.position.x,
                    y: validated.position.y,
                    anchor: 'center'
                },
                reason: decision.reason || '基于审美知识库决策',
                referencedKnowledge,
                processingTime: Date.now() - startTime
            };
            
        } catch (error: any) {
            console.error('[AestheticDecision] AI 决策失败:', error.message);
            
            // 降级到规则引擎
            const fallback = this.makeRuleBasedDecision(request, startTime);
            fallback.reason = `(规则回退) ${fallback.reason}`;
            fallback.confidence = Math.min(fallback.confidence, 0.6);
            return fallback;
        }
    }
    
    /**
     * 验证决策的合理性
     */
    private validateDecision(
        decision: { scale: number; position: { x: number; y: number }; confidence?: number },
        canvas: AestheticDecisionRequest['canvas'],
        asset: AestheticDecisionRequest['asset']
    ): { scale: number; position: { x: number; y: number }; confidence: number } {
        let { scale, position, confidence = 0.8 } = decision;
        
        // 缩放范围限制 (0.1 ~ 5.0)
        scale = Math.max(0.1, Math.min(5.0, scale));
        
        // 计算缩放后尺寸
        const scaledWidth = asset.width * scale;
        const scaledHeight = asset.height * scale;
        
        // 位置边界检查
        const margin = 0.05;  // 5% 边距
        const minX = scaledWidth / 2 + canvas.width * margin;
        const maxX = canvas.width - scaledWidth / 2 - canvas.width * margin;
        const minY = scaledHeight / 2 + canvas.height * margin;
        const maxY = canvas.height - scaledHeight / 2 - canvas.height * margin;
        
        position.x = Math.max(minX, Math.min(maxX, position.x));
        position.y = Math.max(minY, Math.min(maxY, position.y));
        
        // 如果调整幅度大，降低置信度
        if (decision.position.x !== position.x || decision.position.y !== position.y) {
            confidence = Math.min(confidence, 0.7);
        }
        
        // 如果缩放异常，降低置信度
        if (scale < 0.3 || scale > 3.0) {
            confidence = Math.min(confidence, 0.6);
        }
        
        return { scale, position, confidence };
    }
    
    /**
     * 计算位置
     */
    private calculatePosition(
        canvas: { width: number; height: number },
        asset: { width: number; height: number },
        scale: number,
        positionRef: AestheticReference['visualParams']['position']
    ): { x: number; y: number } {
        const scaledWidth = asset.width * scale;
        const scaledHeight = asset.height * scale;
        
        // 基础位置（中心点）
        let x = canvas.width / 2;
        let y = canvas.height / 2;
        
        // 水平位置
        if (positionRef.horizontal === 'left') {
            x = scaledWidth / 2 + canvas.width * 0.1;
        } else if (positionRef.horizontal === 'right') {
            x = canvas.width - scaledWidth / 2 - canvas.width * 0.1;
        }
        
        // 垂直位置
        if (positionRef.vertical === 'top') {
            y = scaledHeight / 2 + canvas.height * 0.1;
        } else if (positionRef.vertical === 'bottom') {
            y = canvas.height - scaledHeight / 2 - canvas.height * 0.1;
        } else if (positionRef.vertical === 'top-third') {
            y = canvas.height / 3;
        } else if (positionRef.vertical === 'bottom-third') {
            y = canvas.height * 2 / 3;
        }
        
        // 应用偏移
        if (positionRef.offsetX) {
            x += canvas.width * positionRef.offsetX;
        }
        if (positionRef.offsetY) {
            y += canvas.height * positionRef.offsetY;
        }
        
        return { x: Math.round(x), y: Math.round(y) };
    }
    
    /**
     * 获取默认参考
     */
    private getDefaultReference(designType: DesignType): AestheticReference {
        return {
            id: 'default',
            name: '默认布局',
            description: '通用默认布局',
            designType,
            style: 'minimal',
            visualParams: {
                subjectRatio: { min: 0.50, ideal: 0.65, max: 0.80 },
                position: {
                    vertical: 'center',
                    horizontal: 'center'
                },
                whitespace: { top: 0.10, bottom: 0.15, left: 0.10, right: 0.10 }
            },
            principles: ['产品居中，保持适当留白'],
            applicableScenarios: ['通用'],
            avoidScenarios: [],
            weight: 0.5
        };
    }
    
    /**
     * 批量决策（用于多个素材）
     */
    async makeMultipleDecisions(
        requests: AestheticDecisionRequest[]
    ): Promise<AestheticDecisionResult[]> {
        // 并行处理，但限制并发数
        const results: AestheticDecisionResult[] = [];
        const batchSize = 3;
        
        for (let i = 0; i < requests.length; i += batchSize) {
            const batch = requests.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(req => this.makeDecision(req))
            );
            results.push(...batchResults);
        }
        
        return results;
    }
    
    /**
     * 判断是否应该自动执行
     */
    shouldAutoExecute(result: AestheticDecisionResult): boolean {
        return result.success && result.confidence >= this.config.highConfidenceThreshold;
    }
    
    /**
     * 判断是否需要用户确认
     */
    needsUserConfirmation(result: AestheticDecisionResult): boolean {
        return result.success && result.confidence < this.config.lowConfidenceThreshold;
    }
}

// ==================== 单例导出 ====================

let instance: AestheticDecisionService | null = null;

export function getAestheticDecisionService(): AestheticDecisionService {
    if (!instance) {
        instance = new AestheticDecisionService();
    }
    return instance;
}

export default AestheticDecisionService;
