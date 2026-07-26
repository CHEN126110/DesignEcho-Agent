/**
 * 视觉思维服务
 * 
 * 核心能力：
 * 1. 基于设计规范计算合适的值（不靠猜）
 * 2. 执行后截图验证效果
 * 3. 迭代调整直到满意
 * 
 * 这让模型拥有"视觉思维"能力
 */

import { ModelService } from './model-service';
import {
    normalizeImageMediaType,
    stripImageDataUrl
} from '../../shared/design-image-input';
import { extractModelJsonObject } from '../../shared/model-json-extract';

export interface GenericImageAnalysis {
    style: string;
    colorPalette: string[];
    composition: string;
    elements: string[];
    suggestions: string[];
    analysisFormat: 'structured' | 'text';
    rawAnalysis?: string;
    modelId: string;
}

function normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.map(item => String(item || '').trim()).filter(Boolean)
        : [];
}

function inferImageMediaTypeFromBase64(data: string): string | undefined {
    if (data.startsWith('iVBORw0KGgo')) return 'image/png';
    if (data.startsWith('/9j/')) return 'image/jpeg';
    if (data.startsWith('UklGR')) return 'image/webp';
    return undefined;
}

function isExplicitVisionFailureText(value: string): boolean {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return /^(?:分析失败|视觉分析失败|无法分析(?:这张|该)?(?:图片|图像)?|不能分析(?:这张|该)?(?:图片|图像)?)(?:[：:，,。.]|$)/i.test(normalized);
}

function resolveImagePayload(imageBase64: string, mediaType?: string): {
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
} {
    const parsed = stripImageDataUrl(imageBase64);
    const data = String(parsed.data || '').trim();
    if (!data) {
        throw new Error('图片数据为空，无法提交视觉分析。');
    }
    return {
        data,
        mediaType: normalizeImageMediaType(
            parsed.mediaType || mediaType || inferImageMediaTypeFromBase64(data)
        )
    };
}

function normalizeGenericImageAnalysis(responseText: string, modelId: string): GenericImageAnalysis {
    const rawText = String(responseText || '').trim();
    if (!rawText) {
        throw new Error(`视觉模型 ${modelId} 返回了空文本。`);
    }

    const extracted = extractModelJsonObject(rawText);
    const value = extracted?.value && typeof extracted.value === 'object'
        ? extracted.value as Record<string, unknown>
        : null;
    if (!value) {
        if (isExplicitVisionFailureText(rawText)) {
            throw new Error(`视觉模型 ${modelId} 明确表示未能分析图片：${rawText.slice(0, 160)}`);
        }
        return {
            style: '',
            colorPalette: [],
            composition: '',
            elements: [],
            suggestions: [],
            analysisFormat: 'text',
            rawAnalysis: rawText,
            modelId
        };
    }

    const result: GenericImageAnalysis = {
        style: String(value.style || '').trim(),
        colorPalette: normalizeStringArray(value.colorPalette),
        composition: String(value.composition || '').trim(),
        elements: normalizeStringArray(value.elements),
        suggestions: normalizeStringArray(value.suggestions),
        analysisFormat: 'structured',
        modelId
    };
    const hasUsableAnalysis = Boolean(
        result.style
        || result.composition
        || result.colorPalette.length
        || result.elements.length
        || result.suggestions.length
    );
    if (!hasUsableAnalysis) {
        throw new Error(`视觉模型 ${modelId} 返回了 JSON，但其中没有可用的视觉分析字段。`);
    }
    if (/^(?:分析失败|无法分析|未知)$/i.test(result.style)
        && !result.composition
        && result.colorPalette.length === 0
        && result.elements.length === 0) {
        throw new Error(`视觉模型 ${modelId} 明确表示未能分析图片。`);
    }
    return result;
}

/**
 * 设计规范 - 基于画布尺寸的比例规则
 */
export const DESIGN_STANDARDS = {
    // 字号规范（相对于画布高度的百分比）
    typography: {
        // 电商主图规范
        ecommerce: {
            mainTitle: { min: 0.06, ideal: 0.08, max: 0.12 },    // 主标题：画布高度的 6-12%
            subTitle: { min: 0.03, ideal: 0.04, max: 0.06 },     // 副标题：画布高度的 3-6%
            price: { min: 0.05, ideal: 0.07, max: 0.10 },        // 价格：画布高度的 5-10%
            cta: { min: 0.025, ideal: 0.035, max: 0.05 },        // 按钮文字：画布高度的 2.5-5%
            body: { min: 0.02, ideal: 0.025, max: 0.03 },        // 正文：画布高度的 2-3%
        },
        // 海报规范
        poster: {
            mainTitle: { min: 0.08, ideal: 0.12, max: 0.18 },
            subTitle: { min: 0.04, ideal: 0.06, max: 0.08 },
            body: { min: 0.02, ideal: 0.03, max: 0.04 },
        },
        // 通用规范
        general: {
            mainTitle: { min: 0.05, ideal: 0.07, max: 0.10 },
            subTitle: { min: 0.03, ideal: 0.04, max: 0.05 },
            body: { min: 0.015, ideal: 0.02, max: 0.025 },
        }
    },
    
    // 间距规范（相对于画布尺寸）
    spacing: {
        margin: { min: 0.03, ideal: 0.05, max: 0.08 },           // 边距
        elementGap: { min: 0.02, ideal: 0.03, max: 0.05 },       // 元素间距
        lineHeight: { min: 1.2, ideal: 1.5, max: 1.8 },          // 行高倍数
    },
    
    // 布局规范
    layout: {
        productImageRatio: { min: 0.5, ideal: 0.65, max: 0.75 }, // 产品图占比
        textAreaRatio: { min: 0.2, ideal: 0.3, max: 0.4 },       // 文字区域占比
        safeMargin: 0.05,                                         // 安全边距
    },
    
    // 视觉层级规范
    hierarchy: {
        fontSizeRatio: 1.5,     // 层级之间字号比例（如标题是副标题的 1.5 倍）
        contrastRatio: 4.5,     // 最小对比度
    }
};

function getOverallStatus(score: number): 'good' | 'acceptable' | 'needs_adjustment' {
    if (score >= 80) return 'good';
    if (score >= 60) return 'acceptable';
    return 'needs_adjustment';
}

/**
 * 视觉评估结果
 */
export interface VisualAssessment {
    overall: 'good' | 'acceptable' | 'needs_adjustment';
    score: number;  // 0-100
    issues: Array<{
        element: string;
        issue: string;
        severity: 'low' | 'medium' | 'high';
        suggestion: string;
        autoFixable: boolean;
        fixAction?: {
            tool: string;
            params: any;
        };
    }>;
    summary: string;
}

/**
 * 视觉思维服务
 */
export class VisualThinkingService {
    private modelService: ModelService;
    // 模型必须来自用户配置的视觉能力槽，不能在服务内部硬编码供应商或模型。
    private visionModelId: string = '';

    constructor(modelService: ModelService) {
        this.modelService = modelService;
    }

    setVisionModelId(modelId: string): void {
        if (modelId) this.visionModelId = modelId;
    }
    
    /**
     * 计算合适的字号（基于设计规范，不靠猜）
     */
    calculateIdealFontSize(
        canvasHeight: number,
        textRole: 'mainTitle' | 'subTitle' | 'price' | 'cta' | 'body',
        designType: 'ecommerce' | 'poster' | 'general' = 'ecommerce'
    ): { min: number; ideal: number; max: number } {
        const standard = DESIGN_STANDARDS.typography[designType][textRole] 
            || DESIGN_STANDARDS.typography.general[textRole]
            || DESIGN_STANDARDS.typography.general.body;
        
        return {
            min: Math.round(canvasHeight * standard.min),
            ideal: Math.round(canvasHeight * standard.ideal),
            max: Math.round(canvasHeight * standard.max)
        };
    }
    
    /**
     * 计算文字是否过大/过小
     */
    assessFontSize(
        currentFontSize: number,
        canvasHeight: number,
        textRole: 'mainTitle' | 'subTitle' | 'price' | 'cta' | 'body'
    ): {
        status: 'too_small' | 'good' | 'too_large';
        currentRatio: number;
        idealSize: number;
        suggestion: string;
    } {
        const ideal = this.calculateIdealFontSize(canvasHeight, textRole);
        const currentRatio = currentFontSize / canvasHeight;
        
        if (currentFontSize < ideal.min) {
            return {
                status: 'too_small',
                currentRatio,
                idealSize: ideal.ideal,
                suggestion: `字号偏小（当前 ${currentFontSize}px），建议调整到 ${ideal.ideal}px（范围 ${ideal.min}-${ideal.max}px）`
            };
        } else if (currentFontSize > ideal.max) {
            return {
                status: 'too_large',
                currentRatio,
                idealSize: ideal.ideal,
                suggestion: `字号偏大（当前 ${currentFontSize}px），建议调整到 ${ideal.ideal}px（范围 ${ideal.min}-${ideal.max}px）`
            };
        } else {
            return {
                status: 'good',
                currentRatio,
                idealSize: ideal.ideal,
                suggestion: `字号合适（当前 ${currentFontSize}px，在合理范围 ${ideal.min}-${ideal.max}px 内）`
            };
        }
    }
    
    /**
     * 视觉评估 - 通过截图分析设计效果
     */
    async assessVisualEffect(
        snapshotBase64: string,
        context: {
            canvasWidth: number;
            canvasHeight: number;
            elements: Array<{
                name: string;
                type: string;
                bounds: { left: number; top: number; right: number; bottom: number };
                fontSize?: number;
                textContent?: string;
            }>;
            recentAction?: string;  // 刚刚执行的操作
            userIntent?: string;    // 用户的原始意图
        }
    ): Promise<VisualAssessment> {
        const issues: VisualAssessment['issues'] = [];
        
        // 1. 基于规则的评估（不需要视觉模型）
        for (const element of context.elements) {
            // 检查是否超出画布
            if (element.bounds.left < 0 || element.bounds.top < 0 ||
                element.bounds.right > context.canvasWidth || 
                element.bounds.bottom > context.canvasHeight) {
                issues.push({
                    element: element.name,
                    issue: '元素超出画布边界',
                    severity: 'high',
                    suggestion: '将元素移回画布内，或调整大小',
                    autoFixable: true,
                    fixAction: {
                        tool: 'moveLayer',
                        params: this.calculateSafePosition(element, context)
                    }
                });
            }
            
            // 检查字号是否合适
            if (element.fontSize && element.type === 'text') {
                const textRole = this.inferTextRole(element);
                const assessment = this.assessFontSize(element.fontSize, context.canvasHeight, textRole);
                
                if (assessment.status !== 'good') {
                    issues.push({
                        element: element.name,
                        issue: assessment.status === 'too_large' ? '字号过大' : '字号过小',
                        severity: assessment.status === 'too_large' ? 'medium' : 'low',
                        suggestion: assessment.suggestion,
                        autoFixable: true,
                        fixAction: {
                            tool: 'setTextStyle',
                            params: { fontSize: assessment.idealSize }
                        }
                    });
                }
            }
            
            // 检查安全边距
            const safeMargin = context.canvasWidth * DESIGN_STANDARDS.layout.safeMargin;
            if (element.bounds.left < safeMargin || 
                element.bounds.right > context.canvasWidth - safeMargin) {
                issues.push({
                    element: element.name,
                    issue: '元素太靠近画布边缘',
                    severity: 'low',
                    suggestion: `建议与边缘保持至少 ${Math.round(safeMargin)}px 的距离`,
                    autoFixable: true,
                    fixAction: {
                        tool: 'moveLayer',
                        params: { x: element.bounds.left < safeMargin ? safeMargin : undefined }
                    }
                });
            }
        }
        
        // 2. 如果有视觉模型，进行更深入的分析
        if (this.modelService && snapshotBase64) {
            try {
                const visionAssessment = await this.assessWithVisionModel(snapshotBase64, context, issues);
                issues.push(...visionAssessment);
            } catch (error) {
                console.warn('[VisualThinking] 视觉模型分析失败，使用规则评估', error);
            }
        }
        
        // 计算总分
        const score = this.calculateScore(issues);
        
        return {
            overall: getOverallStatus(score),
            score,
            issues,
            summary: this.generateSummary(issues, context.recentAction)
        };
    }
    
    /**
     * 使用视觉模型进行深度分析
     */
    private async assessWithVisionModel(
        snapshotBase64: string,
        context: any,
        existingIssues: any[]
    ): Promise<VisualAssessment['issues']> {
        const prompt = `作为专业设计师，分析这张设计图的视觉效果。

画布尺寸：${context.canvasWidth} x ${context.canvasHeight}px
${context.recentAction ? `刚刚执行的操作：${context.recentAction}` : ''}
${context.userIntent ? `用户意图：${context.userIntent}` : ''}

已发现的问题：
${existingIssues.map(i => `- ${i.element}: ${i.issue}`).join('\n') || '暂无'}

请分析：
1. 整体视觉效果如何？
2. 是否有明显的排版问题？
3. 元素大小比例是否协调？
4. 有什么改进建议？

请用 JSON 格式返回：
{
    "visualBalance": "good/poor",
    "issues": [
        {
            "element": "元素名",
            "issue": "问题描述",
            "severity": "low/medium/high",
            "suggestion": "改进建议"
        }
    ]
}`;

        try {
            // 使用支持视觉的模型进行分析
            // 构建包含图像的消息内容
            const messageContent: { type: string; text?: string; image?: { mediaType: string; data: string } }[] = [
                { type: 'text', text: prompt }
            ];
            
            // 如果有图像，添加到消息中
            // 必须使用 {type:'image', image:{mediaType,data}} 格式——
            // OpenAI 风格 {type:'image_url'} 会被各 provider 转换器静默丢弃
            if (snapshotBase64) {
                messageContent.push({
                    type: 'image',
                    image: { mediaType: 'image/png', data: snapshotBase64 }
                });
            }
            
            // 使用默认的视觉模型（如 Gemini 或 OpenRouter 的视觉模型）
            const response = await this.modelService.chat(
                this.visionModelId,  // 统一走 visionModelId（默认小米 MiMo V2.5，用户 API），不再硬编码 Gemini
                [{ role: 'user', content: messageContent as any }],
                { maxTokens: 1000 }
            );
            
            const jsonMatch = response.text?.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                return (result.issues || []).map((issue: any) => ({
                    ...issue,
                    autoFixable: false
                }));
            }
        } catch (error) {
            console.error('[VisualThinking] Vision analysis failed:', error);
        }
        
        return [];
    }
    
    /**
     * 分析本地/通用图片（纯视觉分析，无需图层信息）
     */
    async analyzeGenericImage(
        imageBase64: string,
        promptHint: string = '分析这张图片的设计风格和关键元素',
        mediaType?: string
    ): Promise<GenericImageAnalysis> {
        const prompt = `作为专业设计师，请分析这张图片的视觉设计。
${promptHint}

请提供以下维度的分析：
1. 整体风格（Style）
2. 配色方案（Color Palette，提取主要 HEX 色值）
3. 构图布局（Composition）
4. 关键元素（Key Elements）
5. 设计亮点或改进建议

请用 JSON 格式返回：
{
    "style": "风格描述",
    "colorPalette": ["#RRGGBB", ...],
    "composition": "构图描述",
    "elements": ["元素1", "元素2"...],
    "suggestions": ["建议1", ...]
}`;

        const modelId = String(this.visionModelId || '').trim();
        if (!modelId) {
            throw new Error('未配置视觉模型，无法分析图片。');
        }
        const image = resolveImagePayload(imageBase64, mediaType);
        const messageContent = [
            { type: 'text', text: prompt },
            {
                type: 'image',
                image
            }
        ];

        const response = await this.modelService.chat(
            modelId,
            [{ role: 'user', content: messageContent as any }],
            { maxTokens: 2000 }
        );
        return normalizeGenericImageAnalysis(response.text || '', modelId);
    }

    /**
     * 推断文本角色
     */
    private inferTextRole(element: any): 'mainTitle' | 'subTitle' | 'price' | 'cta' | 'body' {
        const name = element.name.toLowerCase();
        const content = (element.textContent || '').toLowerCase();
        
        if (name.includes('title') || name.includes('标题') || name.includes('主')) {
            return 'mainTitle';
        }
        if (name.includes('sub') || name.includes('副')) {
            return 'subTitle';
        }
        if (name.includes('price') || name.includes('价') || content.includes('¥') || content.includes('$')) {
            return 'price';
        }
        if (name.includes('btn') || name.includes('button') || name.includes('按钮') || name.includes('立即') || name.includes('购买')) {
            return 'cta';
        }
        return 'body';
    }
    
    /**
     * 计算安全位置
     */
    private calculateSafePosition(element: any, context: any): any {
        const bounds = element.bounds;
        const safeMargin = context.canvasWidth * DESIGN_STANDARDS.layout.safeMargin;
        
        let newX = bounds.left;
        let newY = bounds.top;
        
        // 修正 X 位置
        if (bounds.left < 0) {
            newX = safeMargin;
        } else if (bounds.right > context.canvasWidth) {
            newX = context.canvasWidth - (bounds.right - bounds.left) - safeMargin;
        }
        
        // 修正 Y 位置
        if (bounds.top < 0) {
            newY = safeMargin;
        } else if (bounds.bottom > context.canvasHeight) {
            newY = context.canvasHeight - (bounds.bottom - bounds.top) - safeMargin;
        }
        
        return { x: newX, y: newY };
    }
    
    /**
     * 计算评分
     */
    private calculateScore(issues: VisualAssessment['issues']): number {
        let score = 100;
        
        for (const issue of issues) {
            switch (issue.severity) {
                case 'high': score -= 20; break;
                case 'medium': score -= 10; break;
                case 'low': score -= 5; break;
            }
        }
        
        return Math.max(0, score);
    }
    
    /**
     * 生成总结
     */
    private generateSummary(issues: VisualAssessment['issues'], recentAction?: string): string {
        if (issues.length === 0) {
            return '✅ 当前设计效果良好，没有发现明显问题。';
        }
        
        const highSeverity = issues.filter(i => i.severity === 'high');
        const autoFixable = issues.filter(i => i.autoFixable);
        
        let summary = '';
        
        if (highSeverity.length > 0) {
            summary = `⚠️ 发现 ${highSeverity.length} 个需要注意的问题：\n`;
            summary += highSeverity.map(i => `• ${i.element}：${i.issue}`).join('\n');
        } else {
            summary = `💡 发现 ${issues.length} 个可优化的地方。`;
        }
        
        if (autoFixable.length > 0) {
            summary += `\n\n🔧 其中 ${autoFixable.length} 个可以自动修复，需要我帮你处理吗？`;
        }
        
        return summary;
    }
    
    /**
     * 执行自动修复
     */
    async autoFix(
        issues: VisualAssessment['issues'],
        executeToolCall: (tool: string, params: any) => Promise<any>
    ): Promise<{
        fixed: string[];
        failed: string[];
    }> {
        const fixed: string[] = [];
        const failed: string[] = [];
        
        const autoFixable = issues.filter(i => i.autoFixable && i.fixAction);
        
        for (const issue of autoFixable) {
            try {
                await executeToolCall(issue.fixAction!.tool, issue.fixAction!.params);
                fixed.push(`${issue.element}: ${issue.issue}`);
            } catch (error) {
                failed.push(`${issue.element}: ${issue.issue}`);
            }
        }
        
        return { fixed, failed };
    }
    
    /**
     * 迭代优化 - 执行操作后验证效果，必要时调整
     */
    async iterativeOptimize(
        action: { tool: string; params: any },
        getSnapshot: () => Promise<string>,
        getContext: () => Promise<any>,
        executeToolCall: (tool: string, params: any) => Promise<any>,
        maxIterations: number = 3
    ): Promise<{
        success: boolean;
        iterations: number;
        finalAssessment: VisualAssessment;
        actions: Array<{ tool: string; params: any; result: any }>;
    }> {
        const actions: Array<{ tool: string; params: any; result: any }> = [];
        let currentAssessment: VisualAssessment | null = null;
        
        for (let i = 0; i < maxIterations; i++) {
            // 执行操作
            const result = await executeToolCall(action.tool, action.params);
            actions.push({ tool: action.tool, params: action.params, result });
            
            // 获取快照和上下文
            const snapshot = await getSnapshot();
            const context = await getContext();
            context.recentAction = `${action.tool}(${JSON.stringify(action.params)})`;
            
            // 评估效果
            currentAssessment = await this.assessVisualEffect(snapshot, context);
            
            // 如果效果好，停止迭代
            if (currentAssessment.overall === 'good' || currentAssessment.overall === 'acceptable') {
                return {
                    success: true,
                    iterations: i + 1,
                    finalAssessment: currentAssessment,
                    actions
                };
            }
            
            // 尝试自动修复
            const autoFixable = currentAssessment.issues.filter(issue => issue.autoFixable && issue.fixAction);
            if (autoFixable.length === 0) {
                break;  // 没有可自动修复的问题，停止迭代
            }
            
            // 执行第一个自动修复
            action = {
                tool: autoFixable[0].fixAction!.tool,
                params: autoFixable[0].fixAction!.params
            };
        }
        
        return {
            success: false,
            iterations: maxIterations,
            finalAssessment: currentAssessment!,
            actions
        };
    }
}

/**
 * 导出设计规范供其他模块使用
 */
export { DESIGN_STANDARDS as DesignStandards };
