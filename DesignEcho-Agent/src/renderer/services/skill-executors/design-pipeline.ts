/**
 * 设计流程管线：Plan → Execute → Critique
 * 
 * 提供可复用的诊断、规划、视觉评估原语，供各技能执行器组合使用。
 * 所有 AI 调用通过已有 IPC 通道完成，不引入新依赖。
 */

import { executeToolCall } from '../tool-executor.service';

// ==================== 类型 ====================

export interface DesignContext {
    documentInfo: any;
    layerHierarchy?: any[];
    textLayers?: any[];
    platform?: string;
    brandTone?: string;
    styleKeywords?: string[];
    userIntent?: string;
}

export interface DiagnosisReport {
    success: boolean;
    score: number;
    issues: DiagnosisIssue[];
    recommendations: string[];
}

export interface DiagnosisIssue {
    category: string;
    severity: 'high' | 'medium' | 'low';
    description: string;
    suggestion?: string;
    layerId?: number;
}

export interface CritiqueResult {
    beforeScore: number;
    afterScore: number;
    delta: number;
    improved: boolean;
    afterIssues: DiagnosisIssue[];
    recommendations: string[];
}

export function getSeverityIcon(severity: string): string {
    if (severity === 'high') return '🔴';
    if (severity === 'medium') return '🟡';
    return '🟢';
}

export function getDeltaArrow(delta: number): string {
    if (delta > 0) return '↑';
    if (delta < 0) return '↓';
    return '→';
}

// ==================== 诊断 ====================

/**
 * 收集当前文档的设计上下文
 */
export async function collectDesignContext(
    overrides?: Partial<DesignContext>
): Promise<DesignContext> {
    const docInfo = await executeToolCall('getDocumentInfo', {});

    let layerHierarchy: any[] = [];
    let textLayers: any[] = [];

    try {
        const hierarchy = await executeToolCall('getLayerHierarchy', {});
        if (hierarchy?.success) layerHierarchy = hierarchy.layers || hierarchy.data?.layers || [];
    } catch { /* 非阻断 */ }

    try {
        const texts = await executeToolCall('getAllTextLayers', {});
        if (texts?.success) textLayers = texts.layers || texts.data?.layers || [];
    } catch { /* 非阻断 */ }

    return {
        documentInfo: docInfo,
        layerHierarchy,
        textLayers,
        platform: overrides?.platform || 'ecommerce',
        brandTone: overrides?.brandTone || 'professional',
        styleKeywords: overrides?.styleKeywords || [],
        userIntent: overrides?.userIntent
    };
}

/**
 * 执行设计诊断（通过 WebSocket 调用主进程 DesignIntelligenceService）
 */
export async function diagnose(
    context: DesignContext,
    callbacks?: { onMessage?: (msg: string) => void }
): Promise<DiagnosisReport> {
    const fallback: DiagnosisReport = { success: false, score: 0, issues: [], recommendations: [] };

    try {
        const result = await executeToolCall('design-agent.diagnose', {
            platform: context.platform,
            brandTone: context.brandTone,
            styleKeywords: context.styleKeywords,
            userIntent: context.userIntent
        });

        if (result?.success && result?.report) {
            const r = result.report;
            return {
                success: true,
                score: r.score ?? 0,
                issues: (r.issues || []).map((i: any) => ({
                    category: i.category || 'layout',
                    severity: i.severity || 'medium',
                    description: i.description || '',
                    suggestion: i.suggestion,
                    layerId: i.layerId
                })),
                recommendations: r.recommendations || []
            };
        }
    } catch (e: any) {
        console.warn('[DesignPipeline] 诊断失败:', e.message);
        callbacks?.onMessage?.('当前画面分析暂时不可用，先按主图规则继续。');
    }

    return fallback;
}

// ==================== 规划 ====================

/**
 * 基于诊断结果生成执行计划预览（通过 WebSocket 调用 design-agent.plan）
 */
export async function planDesign(
    context: DesignContext,
    callbacks?: { onMessage?: (msg: string) => void }
): Promise<{ report: DiagnosisReport; plan: any[] } | null> {
    try {
        const result = await executeToolCall('design-agent.plan', {
            platform: context.platform,
            brandTone: context.brandTone,
            styleKeywords: context.styleKeywords,
            userIntent: context.userIntent
        });

        if (result?.success && result?.decision) {
            const report: DiagnosisReport = {
                success: true,
                score: result.report?.score ?? 0,
                issues: (result.report?.issues || []).map((i: any) => ({
                    category: i.category || 'layout',
                    severity: i.severity || 'medium',
                    description: i.description || '',
                    suggestion: i.suggestion,
                    layerId: i.layerId
                })),
                recommendations: result.report?.recommendations || []
            };

            const plan = result.decision?.executionPlan || [];

            if (callbacks?.onMessage && plan.length > 0) {
                callbacks.onMessage(`已整理出 ${plan.length} 个调整方向。`);
                for (const [index, step] of plan.slice(0, 5).entries()) {
                    callbacks.onMessage(`调整方向 ${index + 1}: ${step.reason || '按当前画面状态继续优化。'}`);
                }
                if (plan.length > 5) {
                    callbacks.onMessage(`还有 ${plan.length - 5} 个调整方向待处理。`);
                }
            }

            return { report, plan };
        }
    } catch (e: any) {
        console.warn('[DesignPipeline] 规划失败:', e.message);
        callbacks?.onMessage?.('自动规划暂时不可用，先按已确认规则继续。');
    }

    return null;
}

// ==================== 评估 ====================

/**
 * 执行前后对比评估（Critique）
 * 
 * 在操作前调用 diagnose() 获取 beforeReport，操作完成后再次调用 diagnose() 获取 afterReport，
 * 然后调用此函数对比。
 */
export function critique(
    before: DiagnosisReport,
    after: DiagnosisReport
): CritiqueResult {
    const delta = after.score - before.score;
    return {
        beforeScore: before.score,
        afterScore: after.score,
        delta,
        improved: delta > 0,
        afterIssues: after.issues,
        recommendations: after.recommendations
    };
}

/**
 * 格式化评估结果为用户可读消息
 */
export function formatCritique(
    result: CritiqueResult,
    callbacks?: { onMessage?: (msg: string) => void }
): void {
    if (!callbacks?.onMessage) return;

    const arrow = getDeltaArrow(result.delta);
    callbacks.onMessage(
        `画面复核：${result.beforeScore} → ${result.afterScore} (${arrow}${Math.abs(result.delta)})`
    );

    if (result.afterScore < 70 && result.afterIssues.length > 0) {
        callbacks.onMessage(`⚠️ 仍有 ${result.afterIssues.length} 个问题待优化:`);
        for (const issue of result.afterIssues.slice(0, 3)) {
            const icon = getSeverityIcon(issue.severity);
            callbacks.onMessage(`   ${icon} ${issue.description}`);
        }
    }

    for (const rec of result.recommendations.slice(0, 2)) {
        callbacks.onMessage(`   💡 ${rec}`);
    }
}

/**
 * 完整的 Plan-Execute-Critique 管线包装器
 * 
 * 用法示例:
 *   const pipeline = createPipeline(context, callbacks);
 *   const before = await pipeline.before();     // 诊断 + 规划
 *   // ... 执行器自身的核心操作 ...
 *   const after = await pipeline.after(before);  // 复评 + 对比
 */
export function createPipeline(
    context: DesignContext,
    callbacks?: { onMessage?: (msg: string) => void }
) {
    return {
        /** 执行前：诊断现状，输出规划 */
        async before(): Promise<DiagnosisReport> {
            const report = await diagnose(context, callbacks);
            if (report.success && report.score > 0) {
                callbacks?.onMessage?.(`当前画面检查结果：${report.score}/100`);
                if (report.issues.length > 0) {
                    callbacks?.onMessage?.(`   发现 ${report.issues.length} 个待优化项`);
                }
            }
            return report;
        },

        /** 执行后：复评并与之前对比 */
        async after(beforeReport: DiagnosisReport): Promise<CritiqueResult | null> {
            if (!beforeReport.success) return null;

            const afterReport = await diagnose(context, callbacks);
            if (!afterReport.success) return null;

            const result = critique(beforeReport, afterReport);
            formatCritique(result, callbacks);
            return result;
        }
    };
}
