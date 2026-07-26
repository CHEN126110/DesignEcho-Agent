/**
 * 设计计划执行辅助工具
 *
 * 提供 trace 跟踪、计划步骤解析等可复用原语，
 * 供 detail-page / main-image 等执行器共用。
 */

import type { DesignPlan, DesignPlanStep } from './design-plan';
import type { PlanExecutionTrace } from './detail-page.types';

/**
 * 从 DesignPlan 中提取规范化的步骤列表与快速查找 Map
 */
export function extractPlanSteps(plan: DesignPlan): {
    steps: DesignPlanStep[];
    stepMap: Map<string, DesignPlanStep>;
    has: (tool: string) => boolean;
} {
    const steps = (plan.steps && plan.steps.length > 0)
        ? plan.steps
        : (plan.layoutSteps || []);
    const stepMap = new Map(steps.map(s => [s.tool, s]));
    return {
        steps,
        stepMap,
        has: (tool: string) => stepMap.has(tool),
    };
}

/**
 * 创建一个可变的执行跟踪器
 */
export function createTracer(steps: DesignPlanStep[]) {
    const traces: PlanExecutionTrace[] = steps.map(s => ({
        tool: s.tool,
        status: 'planned' as const,
        reason: s.reason,
    }));

    function upsert(tool: string, status: PlanExecutionTrace['status'], details?: string) {
        const existing = traces.find(t => t.tool === tool);
        if (existing) {
            existing.status = status;
            if (details) existing.details = details;
        } else {
            traces.push({ tool, status, details });
        }
    }

    return { traces, upsert };
}

/**
 * 获取某个步骤的参数（带默认空对象）
 */
export function getStepParams(stepMap: Map<string, DesignPlanStep>, tool: string): Record<string, any> {
    return (stepMap.get(tool)?.params || {}) as Record<string, any>;
}
