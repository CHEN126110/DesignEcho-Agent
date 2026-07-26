/**
 * 布局规则服务
 * 
 * 提供"审美缩放"能力：根据设计类型和规则计算最佳产品尺寸
 * 
 * 三层架构:
 * - Level 1: 规则引擎（本文件实现）
 * - Level 2: Eagle 案例学习（待实现）
 * - Level 3: AI 视觉评估（未来）
 */

import * as fs from 'fs';
import * as path from 'path';

// ==================== 类型定义 ====================

export interface LayoutRules {
    version: string;
    designTypes: Record<string, DesignTypeRule>;
    goldenRules: GoldenRules;
    sockSpecific?: SockSpecificRules;
}

export interface DesignTypeRule {
    name: string;
    description: string;
    canvasSize?: { width: number; height: number };
    productRatio: {
        min: number;
        optimal: number;
        max: number;
        description: string;
    };
    position?: {
        vertical: 'center' | 'top-third' | 'bottom-third';
        horizontalOffset?: number;
        verticalOffset?: number;
        description?: string;
    };
    rules?: string[];
}

export interface GoldenRules {
    goldenRatio: number;
    thirdRule: number;
    visualCenter: { description: string; offset: number };
    minimumMargin: { description: string; ratio: number };
}

export interface SockSpecificRules {
    description: string;
    aspectRatio: Record<string, { width: number; height: number; description: string }>;
    displayAngle: { preferred: string; alternatives: string[] };
}

export type DesignType = 'mainImage' | 'detailHero' | 'skuImage' | 'colorShowcase' | 'auto';

export interface ScaleRecommendation {
    targetHeight: number;
    targetWidth: number;
    scalePercent: number;
    confidence: number;  // 0-1, 置信度
    source: 'rule' | 'eagle' | 'ai';  // 推荐来源
    explanation: string;  // 中文解释
}

export interface LayoutContext {
    canvasWidth: number;
    canvasHeight: number;
    currentSubjectWidth: number;
    currentSubjectHeight: number;
    designType?: DesignType;
    sockCategory?: string;  // 'boat' | 'ankle' | 'crew' | 'calf' | 'knee'
    itemCount?: number;  // 用于多产品排列
}

// ==================== 服务类 ====================

export class LayoutRulesService {
    private rules: LayoutRules | null = null;
    private rulesPath: string;
    
    constructor(rulesPath?: string) {
        this.rulesPath = rulesPath || path.join(
            __dirname, 
            '../../..', 
            'resources/layout-rules.json'
        );
    }
    
    /**
     * 初始化服务，加载规则文件
     */
    async initialize(): Promise<boolean> {
        try {
            if (!fs.existsSync(this.rulesPath)) {
                console.warn(`[LayoutRulesService] 规则文件不存在: ${this.rulesPath}`);
                return false;
            }
            
            const content = fs.readFileSync(this.rulesPath, 'utf-8');
            this.rules = JSON.parse(content);
            console.log(`[LayoutRulesService] ✓ 加载布局规则 v${this.rules?.version}`);
            return true;
        } catch (error: any) {
            console.error(`[LayoutRulesService] 加载规则失败: ${error.message}`);
            return false;
        }
    }
    
    /**
     * 计算推荐的产品尺寸
     * 
     * @param context 布局上下文（画布尺寸、当前主体尺寸等）
     * @returns 缩放建议
     */
    calculateRecommendedScale(context: LayoutContext): ScaleRecommendation {
        const { canvasWidth, canvasHeight, currentSubjectWidth, currentSubjectHeight } = context;
        
        // 1. 自动检测设计类型（如果未指定）
        const designType = context.designType || this.detectDesignType(canvasWidth, canvasHeight);
        
        // 2. 获取该设计类型的规则
        const typeRule = this.getDesignTypeRule(designType);
        
        // 3. 计算最佳产品高度
        const optimalRatio = typeRule.productRatio.optimal;
        const targetHeight = canvasHeight * optimalRatio;
        
        // 4. 保持产品宽高比
        const aspectRatio = currentSubjectWidth / currentSubjectHeight;
        const targetWidth = targetHeight * aspectRatio;
        
        // 5. 边界检查：确保不超出画布
        let finalHeight = targetHeight;
        let finalWidth = targetWidth;
        
        const minMargin = this.rules?.goldenRules.minimumMargin.ratio || 0.05;
        const maxWidth = canvasWidth * (1 - minMargin * 2);
        const maxHeight = canvasHeight * (1 - minMargin * 2);
        
        if (finalWidth > maxWidth) {
            finalWidth = maxWidth;
            finalHeight = finalWidth / aspectRatio;
        }
        
        if (finalHeight > maxHeight) {
            finalHeight = maxHeight;
            finalWidth = finalHeight * aspectRatio;
        }
        
        // 6. 计算缩放百分比
        const scalePercent = (finalHeight / currentSubjectHeight) * 100;
        
        // 7. 构建解释
        const explanation = this.buildExplanation(
            designType,
            typeRule,
            optimalRatio,
            scalePercent,
            currentSubjectHeight,
            finalHeight
        );
        
        return {
            targetHeight: Math.round(finalHeight),
            targetWidth: Math.round(finalWidth),
            scalePercent: Math.round(scalePercent * 10) / 10,
            confidence: 0.8,  // 规则引擎的置信度
            source: 'rule',
            explanation
        };
    }
    
    /**
     * 根据画布尺寸自动检测设计类型
     */
    private detectDesignType(width: number, height: number): DesignType {
        const ratio = width / height;
        
        // 正方形 → 主图或SKU
        if (ratio > 0.95 && ratio < 1.05) {
            return width > 600 ? 'mainImage' : 'skuImage';
        }
        
        // 竖版 → 详情页
        if (ratio < 0.9) {
            return 'detailHero';
        }
        
        // 横版 → 可能是颜色展示区
        if (ratio > 1.5) {
            return 'colorShowcase';
        }
        
        return 'mainImage';  // 默认
    }
    
    /**
     * 获取设计类型规则
     */
    private getDesignTypeRule(designType: DesignType): DesignTypeRule {
        if (this.rules && this.rules.designTypes[designType]) {
            return this.rules.designTypes[designType];
        }
        
        // 默认规则
        return {
            name: '默认',
            description: '通用布局规则',
            productRatio: {
                min: 0.50,
                optimal: 0.65,
                max: 0.80,
                description: '产品占画布的比例'
            }
        };
    }
    
    /**
     * 构建中文解释
     */
    private buildExplanation(
        designType: DesignType,
        rule: DesignTypeRule,
        optimalRatio: number,
        scalePercent: number,
        originalHeight: number,
        targetHeight: number
    ): string {
        const typeName = rule.name || designType;
        const percentRatio = Math.round(optimalRatio * 100);
        
        if (Math.abs(scalePercent - 100) < 2) {
            return `当前尺寸已接近最佳比例（${typeName}：产品占 ${percentRatio}%）`;
        }
        
        const action = scalePercent > 100 ? '放大' : '缩小';
        const change = Math.abs(Math.round(scalePercent - 100));
        
        return `根据「${typeName}」规则，产品应占画布高度的 ${percentRatio}%，需${action} ${change}%（${Math.round(originalHeight)}→${Math.round(targetHeight)}px）`;
    }
    
    /**
     * 检查当前布局是否符合规则
     */
    evaluateCurrentLayout(context: LayoutContext): {
        isOptimal: boolean;
        currentRatio: number;
        optimalRange: { min: number; max: number };
        suggestion: string;
    } {
        const designType = context.designType || this.detectDesignType(
            context.canvasWidth, 
            context.canvasHeight
        );
        const rule = this.getDesignTypeRule(designType);
        
        const currentRatio = context.currentSubjectHeight / context.canvasHeight;
        const isOptimal = currentRatio >= rule.productRatio.min && 
                          currentRatio <= rule.productRatio.max;
        
        let suggestion: string;
        if (currentRatio < rule.productRatio.min) {
            suggestion = `产品过小（${Math.round(currentRatio * 100)}%），建议放大到 ${Math.round(rule.productRatio.optimal * 100)}%`;
        } else if (currentRatio > rule.productRatio.max) {
            suggestion = `产品过大（${Math.round(currentRatio * 100)}%），建议缩小到 ${Math.round(rule.productRatio.optimal * 100)}%`;
        } else {
            suggestion = `当前比例合适（${Math.round(currentRatio * 100)}%）`;
        }
        
        return {
            isOptimal,
            currentRatio,
            optimalRange: {
                min: rule.productRatio.min,
                max: rule.productRatio.max
            },
            suggestion
        };
    }
    
    /**
     * 获取已加载的规则
     */
    getRules(): LayoutRules | null {
        return this.rules;
    }
    
    /**
     * 获取所有支持的设计类型
     */
    getSupportedDesignTypes(): string[] {
        if (!this.rules) return [];
        return Object.keys(this.rules.designTypes);
    }
}

// ==================== 工厂函数 ====================

let serviceInstance: LayoutRulesService | null = null;

export async function getLayoutRulesService(): Promise<LayoutRulesService> {
    if (!serviceInstance) {
        serviceInstance = new LayoutRulesService();
        await serviceInstance.initialize();
    }
    return serviceInstance;
}

export default LayoutRulesService;
