import { TaskOrchestrator } from './task-orchestrator';
import { LayoutRulesService } from './layout-rules-service';
import { AestheticDecisionService } from './aesthetic/aesthetic-decision-service';
import { DesignType } from './aesthetic/types';

export interface DesignConstraintProfile {
    platform?: string;
    brandTone?: string;
    styleKeywords?: string[];
    hardConstraints?: Record<string, unknown>;
    softConstraints?: Record<string, unknown>;
}

export interface DesignDiagnosisInput {
    documentInfo: any;
    layerHierarchy: any[];
    textLayers: any[];
    layoutAnalysis?: any;
    constraints: DesignConstraintProfile;
    userIntent?: string;
}

export interface DesignIssue {
    category: 'layout' | 'copy' | 'style';
    severity: 'high' | 'medium' | 'low';
    layerId?: number;
    description: string;
    suggestion: string;
}

export interface DesignDiagnosisReport {
    success: boolean;
    score: number;
    issues: DesignIssue[];
    layoutMetrics: {
        ratioCheck: {
            isOptimal: boolean;
            currentRatio: number;
            min: number;
            max: number;
        };
        overallScore?: number;
    };
    recommendations: string[];
    context: {
        documentSize: { width: number; height: number };
        textLayerCount: number;
        layerCount: number;
    };
}

export interface DesignDecision {
    success: boolean;
    confidence: number;
    reason: string;
    layoutPlan: {
        style: string;
        alignmentStrategy: string;
        whitespaceStrategy: string;
    };
    copyPlan: {
        tone: string;
        ctaStyle: string;
        lengthBudget: 'short' | 'medium' | 'long';
    };
    executionPlan: Array<{
        tool: 'moveLayer' | 'setTextStyle' | 'transformLayer';
        params: Record<string, unknown>;
        reason: string;
    }>;
}

export interface DesignExecutionEvaluation {
    beforeScore: number;
    afterScore: number;
    delta: number;
    accepted: boolean;
    shouldIterate: boolean;
    reason: string;
}

export class DesignIntelligenceService {
    private taskOrchestrator: TaskOrchestrator;
    private layoutRulesService: LayoutRulesService | null;
    private aestheticDecisionService: AestheticDecisionService;

    constructor(
        taskOrchestrator: TaskOrchestrator,
        layoutRulesService: LayoutRulesService | null
    ) {
        this.taskOrchestrator = taskOrchestrator;
        this.layoutRulesService = layoutRulesService;
        this.aestheticDecisionService = new AestheticDecisionService({ fastMode: true });
    }

    buildConstraintProfile(input: any): DesignConstraintProfile {
        return {
            platform: input?.platform || 'ecommerce',
            brandTone: input?.brandTone || 'professional',
            styleKeywords: Array.isArray(input?.styleKeywords) ? input.styleKeywords : [],
            hardConstraints: {
                minMarginRatio: 0.05,
                maxTextLines: 4,
                ...(input?.hardConstraints || {})
            },
            softConstraints: {
                preferredTitleBodyRatio: '3:1.5:1',
                preferredVisualBalance: 'center',
                ...(input?.softConstraints || {})
            }
        };
    }

    async buildDiagnosisInput(params: {
        documentInfo: any;
        layerHierarchy: any[];
        textLayers: any[];
        constraints: DesignConstraintProfile;
        userIntent?: string;
    }): Promise<DesignDiagnosisInput> {
        const layoutAnalysis = await this.taskOrchestrator.execute(
            'layout-analysis',
            {
                documentInfo: params.documentInfo,
                layers: params.layerHierarchy,
                textLayers: params.textLayers,
                constraints: params.constraints
            },
            {
                constraintProfile: params.constraints,
                decisionContext: {
                    stage: 'diagnosis',
                    goal: 'analyze-layout'
                }
            }
        );

        return {
            documentInfo: params.documentInfo,
            layerHierarchy: params.layerHierarchy,
            textLayers: params.textLayers,
            layoutAnalysis,
            constraints: params.constraints,
            userIntent: params.userIntent
        };
    }

    generateDiagnosisReport(input: DesignDiagnosisInput): DesignDiagnosisReport {
        const docWidth = Number(input?.documentInfo?.data?.width || input?.documentInfo?.width || 0);
        const docHeight = Number(input?.documentInfo?.data?.height || input?.documentInfo?.height || 0);
        const allLayers = this.flattenLayers(input.layerHierarchy || []);
        const textLayers = Array.isArray(input.textLayers) ? input.textLayers : [];
        const topVisualLayer = this.pickPrimaryVisualLayer(allLayers);

        const ratioCheck = this.getRatioCheck({
            docWidth,
            docHeight,
            topVisualLayer
        });

        const issues: DesignIssue[] = [];
        const llmIssues = input?.layoutAnalysis?.issues;
        if (Array.isArray(llmIssues)) {
            for (const issue of llmIssues) {
                issues.push({
                    category: 'layout',
                    severity: this.normalizeSeverity(issue?.severity),
                    layerId: typeof issue?.layerId === 'number' ? issue.layerId : undefined,
                    description: String(issue?.description || '布局存在潜在问题'),
                    suggestion: String(issue?.suggestion || '请进行对齐与间距修正')
                });
            }
        }

        for (const layer of textLayers) {
            const text = String(layer?.contents || '').trim();
            if (text.length > 36) {
                issues.push({
                    category: 'copy',
                    severity: 'medium',
                    layerId: Number(layer?.id || 0) || undefined,
                    description: `文案过长（${text.length} 字），可能影响版面呼吸感`,
                    suggestion: '收敛到 14-30 字，保留核心卖点与行动词'
                });
            }
        }

        if (!ratioCheck.isOptimal) {
            issues.push({
                category: 'style',
                severity: 'medium',
                description: ratioCheck.currentRatio < ratioCheck.min
                    ? '主体占比偏小，视觉重心不足'
                    : '主体占比偏大，留白不足',
                suggestion: `建议主体占比控制在 ${(ratioCheck.min * 100).toFixed(0)}%-${(ratioCheck.max * 100).toFixed(0)}%`
            });
        }

        const llmScore = Number(input?.layoutAnalysis?.overallScore);
        const penalty = issues.reduce((acc, issue) => {
            if (issue.severity === 'high') return acc + 20;
            if (issue.severity === 'medium') return acc + 10;
            return acc + 4;
        }, 0);
        const score = Number.isFinite(llmScore)
            ? Math.max(0, Math.min(100, Math.round((llmScore * 0.6) + ((100 - penalty) * 0.4))))
            : Math.max(0, 100 - penalty);

        return {
            success: true,
            score,
            issues,
            layoutMetrics: {
                ratioCheck,
                overallScore: Number.isFinite(llmScore) ? llmScore : undefined
            },
            recommendations: this.buildRecommendations(issues, ratioCheck),
            context: {
                documentSize: { width: docWidth, height: docHeight },
                textLayerCount: textLayers.length,
                layerCount: allLayers.length
            }
        };
    }

    async makeDecision(input: {
        diagnosis: DesignDiagnosisReport;
        diagnosisInput: DesignDiagnosisInput;
    }): Promise<DesignDecision> {
        const diagnosis = input.diagnosis;
        const diagnosisInput = input.diagnosisInput;
        const allLayers = this.flattenLayers(diagnosisInput.layerHierarchy || []);
        const primaryVisualLayer = this.pickPrimaryVisualLayer(allLayers);
        const firstTextLayer = (diagnosisInput.textLayers || [])[0];

        const designType = this.mapDesignType(diagnosisInput.constraints.platform);
        const aesthetic = await this.aestheticDecisionService.makeDecision({
            designType,
            canvas: {
                width: diagnosis.context.documentSize.width,
                height: diagnosis.context.documentSize.height
            },
            asset: {
                id: String(primaryVisualLayer?.id || 'main-asset'),
                width: Number(primaryVisualLayer?.bounds?.width || diagnosis.context.documentSize.width * 0.6),
                height: Number(primaryVisualLayer?.bounds?.height || diagnosis.context.documentSize.height * 0.6)
            },
            userIntent: diagnosisInput.userIntent || '',
            preferredStyle: this.mapPreferredStyle(diagnosisInput.constraints.styleKeywords)
        });

        const executionPlan: DesignDecision['executionPlan'] = [];
        const llmFixes = diagnosisInput?.layoutAnalysis?.fixes;
        if (Array.isArray(llmFixes)) {
            for (const fix of llmFixes.slice(0, 8)) {
                const layerId = Number(fix?.layerId || 0);
                const action = String(fix?.action || '');
                const changes = fix?.changes || {};
                if (!layerId) continue;
                if (action === 'move') {
                    const x = this.pickNumber(changes?.x, changes?.left, changes?.targetX);
                    const y = this.pickNumber(changes?.y, changes?.top, changes?.targetY);
                    if (x !== null || y !== null) {
                        executionPlan.push({
                            tool: 'moveLayer',
                            params: { layerId, x: x ?? undefined, y: y ?? undefined, relative: false },
                            reason: String(fix?.reason || '根据排版分析进行位置修正')
                        });
                    }
                } else if (action === 'restyle') {
                    const fontSize = this.pickNumber(changes?.fontSize, changes?.size);
                    const tracking = this.pickNumber(changes?.tracking);
                    const leading = this.pickNumber(changes?.leading, changes?.lineHeight);
                    if (fontSize !== null || tracking !== null || leading !== null) {
                        executionPlan.push({
                            tool: 'setTextStyle',
                            params: {
                                layerId,
                                fontSize: fontSize ?? undefined,
                                tracking: tracking ?? undefined,
                                leading: leading ?? undefined
                            },
                            reason: String(fix?.reason || '根据排版分析进行文字层级修正')
                        });
                    }
                }
            }
        }

        if (primaryVisualLayer?.id && aesthetic.success && Number.isFinite(aesthetic.scale)) {
            const uniformPercent = Math.max(50, Math.min(160, Math.round(aesthetic.scale * 100)));
            executionPlan.unshift({
                tool: 'transformLayer',
                params: {
                    layerId: Number(primaryVisualLayer.id),
                    scaleUniform: uniformPercent
                },
                reason: `基于审美决策调整主体占比（置信度 ${(aesthetic.confidence * 100).toFixed(0)}%）`
            });
        }

        if (firstTextLayer?.id && diagnosis.score < 82) {
            executionPlan.push({
                tool: 'setTextStyle',
                params: {
                    layerId: Number(firstTextLayer.id),
                    tracking: 10
                },
                reason: '轻量提升标题可读性与节奏感'
            });
        }

        const confidence = Math.max(
            0.45,
            Math.min(0.95, (diagnosis.score / 100) * 0.5 + (aesthetic.confidence || 0.7) * 0.5)
        );

        return {
            success: true,
            confidence,
            reason: `诊断分 ${diagnosis.score}，结合审美决策生成 ${executionPlan.length} 条执行动作`,
            layoutPlan: {
                style: diagnosisInput.constraints.styleKeywords?.join('/') || 'balanced',
                alignmentStrategy: '优先修正高严重度对齐问题',
                whitespaceStrategy: '保持 5% 以上安全边距'
            },
            copyPlan: {
                tone: diagnosisInput.constraints.brandTone || 'professional',
                ctaStyle: '直接行动型',
                lengthBudget: firstTextLayer && String(firstTextLayer.contents || '').length > 30 ? 'short' : 'medium'
            },
            executionPlan
        };
    }

    evaluateExecution(params: {
        before: DesignDiagnosisReport;
        after: DesignDiagnosisReport;
        executedCount: number;
    }): DesignExecutionEvaluation {
        const delta = params.after.score - params.before.score;
        const accepted = params.executedCount > 0 && delta >= 0;
        const shouldIterate = params.executedCount > 0 && params.after.score < 85 && delta < 6;
        const reason = accepted
            ? `评分变化 ${params.before.score} -> ${params.after.score}`
            : '执行未产生可接受提升';
        return {
            beforeScore: params.before.score,
            afterScore: params.after.score,
            delta,
            accepted,
            shouldIterate,
            reason
        };
    }

    private buildRecommendations(issues: DesignIssue[], ratioCheck: DesignDiagnosisReport['layoutMetrics']['ratioCheck']): string[] {
        const recommendations: string[] = [];
        const highCount = issues.filter(i => i.severity === 'high').length;
        if (highCount > 0) {
            recommendations.push(`优先处理 ${highCount} 个高风险问题，再调整细节`);
        }
        if (!ratioCheck.isOptimal) {
            recommendations.push('先修正主体占比，再进行文字层级微调');
        }
        if (issues.some(i => i.category === 'copy')) {
            recommendations.push('文案先收敛字数，再执行字重与字距优化');
        }
        if (recommendations.length === 0) {
            recommendations.push('当前布局已接近目标，可做轻量风格增强');
        }
        return recommendations;
    }

    private normalizeSeverity(value: unknown): 'high' | 'medium' | 'low' {
        const normalized = String(value || '').toLowerCase();
        if (normalized === 'high') return 'high';
        if (normalized === 'low') return 'low';
        return 'medium';
    }

    private flattenLayers(input: any[]): any[] {
        const out: any[] = [];
        const walk = (items: any[]) => {
            for (const item of items || []) {
                out.push(item);
                if (Array.isArray(item?.children)) {
                    walk(item.children);
                }
                if (Array.isArray(item?.layers)) {
                    walk(item.layers);
                }
            }
        };
        walk(input);
        return out;
    }

    private pickPrimaryVisualLayer(layers: any[]): any | null {
        const candidates = layers.filter(layer => {
            const kind = String(layer?.kind || '').toLowerCase();
            return kind !== 'text' && kind !== 'group' && layer?.bounds?.width && layer?.bounds?.height;
        });
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort((a, b) => {
            const areaA = Number(a.bounds.width || 0) * Number(a.bounds.height || 0);
            const areaB = Number(b.bounds.width || 0) * Number(b.bounds.height || 0);
            return areaB - areaA;
        });
        return candidates[0];
    }

    private getRatioCheck(params: {
        docWidth: number;
        docHeight: number;
        topVisualLayer: any | null;
    }): {
        isOptimal: boolean;
        currentRatio: number;
        min: number;
        max: number;
    } {
        if (!params.docWidth || !params.docHeight || !params.topVisualLayer?.bounds?.height) {
            return { isOptimal: true, currentRatio: 0.65, min: 0.5, max: 0.8 };
        }
        if (!this.layoutRulesService) {
            const ratio = Number(params.topVisualLayer.bounds.height) / params.docHeight;
            return { isOptimal: ratio >= 0.5 && ratio <= 0.8, currentRatio: ratio, min: 0.5, max: 0.8 };
        }
        const evaluated = this.layoutRulesService.evaluateCurrentLayout({
            canvasWidth: params.docWidth,
            canvasHeight: params.docHeight,
            currentSubjectWidth: Number(params.topVisualLayer.bounds.width),
            currentSubjectHeight: Number(params.topVisualLayer.bounds.height),
            designType: 'auto'
        });
        return {
            isOptimal: evaluated.isOptimal,
            currentRatio: evaluated.currentRatio,
            min: evaluated.optimalRange.min,
            max: evaluated.optimalRange.max
        };
    }

    private pickNumber(...values: any[]): number | null {
        for (const value of values) {
            const num = Number(value);
            if (Number.isFinite(num)) {
                return num;
            }
        }
        return null;
    }

    private mapDesignType(platform?: string): DesignType {
        const normalized = String(platform || '').toLowerCase();
        if (normalized.includes('banner')) return 'banner';
        if (normalized.includes('sku')) return 'skuImage';
        if (normalized.includes('detail')) return 'detailHero';
        return 'mainImage';
    }

    private mapPreferredStyle(styleKeywords?: string[]): any {
        const text = (styleKeywords || []).join(' ').toLowerCase();
        if (text.includes('high') || text.includes('premium')) return 'premium';
        if (text.includes('minimal') || text.includes('简约')) return 'minimal';
        if (text.includes('dynamic') || text.includes('活力')) return 'dynamic';
        return 'elegant';
    }
}
