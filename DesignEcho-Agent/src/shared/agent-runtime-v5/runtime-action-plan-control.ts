/** R4 Action Plan 控制工具的轻量身份；大体积 schema/validator 由 Agent 按需加载。 */

export const DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME = 'declareRuntimeActionPlan';

export function isRuntimeActionPlanControlTool(value: unknown): boolean {
    return String(value || '').trim() === DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME;
}
