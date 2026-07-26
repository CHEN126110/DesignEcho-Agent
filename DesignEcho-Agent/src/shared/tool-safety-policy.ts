import { TOOL_SAFETY_POLICY_CAPABILITY_ID } from './agent-runtime-v5/capability-provider-identities';

export const TOOL_SAFETY_POLICY_VERSION = TOOL_SAFETY_POLICY_CAPABILITY_ID;

/**
 * 工具安全策略（声明式）——V0-3 破坏性动作确定性守卫的单一事实源。
 *
 * 背景（2026-07-08 治理审计）：closeDocument(不保存) 等真正跨越 Photoshop 历史恢复边界的动作此前
 * 零确定性守卫，只靠系统提示里一句 'non-destructive' 文本约束（autonomous-agent.executor.ts）。
 * 更糟的是安全被错做成"设计纪律的子集"——只有设计纪律 active 时才可能有保护，方向反了。
 * 安全必须是全局最外层、与"是不是设计任务"无关。这里用一张声明式表 + 纯函数裁决，
 * 也是 V2「声明式 tool-policy 表 + 统一裁决器」的种子。
 *
 * 红线：这是"确定性代码 hook"，不是"模型自觉"。规则能确定的用代码，判断性的才交模型。
 */

export type ToolSafetyClass = 'destructive' | 'overwrite';

export interface ToolSafetyRule {
    /** 风险类别 */
    class: ToolSafetyClass;
    /** 是否可逆（可逆动作不进本表） */
    reversible: false;
    /** 显式确认参数名：调用参数里该字段 === true 视为已确认放行 */
    confirmParam: string;
    /**
     * 该次调用是否真的触发破坏性分支。有些工具只在特定参数下才破坏
     * （如 closeDocument 仅在 save!==true 时丢弃修改）；省略=该工具任何调用都破坏。
     */
    isDestructive?: (params: any) => boolean;
    /** 人类可读的风险说明，进拦截消息 */
    reason: string;
}

/**
 * 破坏性动作声明表。V0 保守收口：只纳入"高危 + 盲调罕有正当理由"的动作，
 * 避免误伤常见流程——例如 saveDocument 覆盖自己的在制品是正常保存，暂不纳入，
 * 留待 V1 精确判断"是否覆盖了不同的既有源文件"再收。
 */
export const TOOL_SAFETY_POLICY: Readonly<Record<string, ToolSafetyRule>> = Object.freeze({
    closeDocument: {
        class: 'destructive',
        reversible: false,
        confirmParam: 'confirmDestructive',
        // 只在"不保存关闭"时才丢弃未保存修改；save===true 是正常保存关闭，不拦。
        isDestructive: (params: any) => params?.save !== true,
        reason: '关闭文档且不保存会丢弃所有未保存的修改'
    },
    // V1-7a（治理审计 2026-07-08）：真实浏览器点击纳入安全表。interactWithBrowserPage 直接操作
    // 用户真实浏览器，click 可能触发支付/下单/删除/发布等不可逆动作，且真实页面无法确定性识别
    // "支付按钮"语义——故 click 默认高危、需显式确认；fill 只写值不提交、scroll 只读，均不拦
    // （isDestructive 仅认 action==='click'）。确认参数用 confirmSensitiveAction，与破坏性 PS
    // 动作的 confirmDestructive 分开，语义更贴近"敏感操作确认"。
    // 注意：本条只提供"确定性拦截 + 需显式确认参数"这一层；真正的"人类确认"门由 V1-7b HITL 卡落地，
    // 在 7b 之前，模型可从拦截消息自补 confirmSensitiveAction 重试（与 confirmDestructive 同构的固有边界）。
    interactWithBrowserPage: {
        class: 'destructive',
        reversible: false,
        confirmParam: 'confirmSensitiveAction',
        isDestructive: (params: any) => params?.action === 'click',
        reason: '在用户真实浏览器里点击可能触发支付、下单、删除或发布等不可逆动作，且无法确定性识别按钮语义，需先经用户确认'
    }
});

export interface ToolSafetyVerdict {
    blocked: true;
    toolName: string;
    class: ToolSafetyClass;
    requiredConfirmParam: string;
    message: string;
}

/**
 * 裁决一次工具调用是否被破坏性安全策略拦截。
 * 返回 null = 放行（非破坏性工具、非破坏性分支、或已带确认参数）。
 * 返回 verdict = 拦截；调用方应把它作为 policyGate 结果返回（不计入失败熔断）。
 */
export function evaluateToolSafety(toolName: string, params: any): ToolSafetyVerdict | null {
    const rule = TOOL_SAFETY_POLICY[toolName];
    if (!rule) return null;
    const destructive = rule.isDestructive ? rule.isDestructive(params) : true;
    if (!destructive) return null;
    const confirmed = params?.[rule.confirmParam] === true;
    if (confirmed) return null;
    return {
        blocked: true,
        toolName,
        class: rule.class,
        requiredConfirmParam: rule.confirmParam,
        message:
            `破坏性操作被安全策略拦截：${toolName} —— ${rule.reason}。` +
            `这是不可逆操作，不能直接执行。若确实需要，请先向用户确认，再在调用参数中带 ${rule.confirmParam}: true 重试；` +
            `或改用非破坏性方式（例如先 saveDocument 再关闭文档，或让用户自行完成外部敏感动作）。`
    };
}

/**
 * 委派（子代理）语境下的破坏性动作**硬拦**。与 evaluateToolSafety 的关键区别：**忽略调用自带的确认参数**。
 *
 * 背景（治理审计 2026-07-08 既有盲区收口）：DesignTeamCoordinator 给设计队友子代理用的是原始
 * executeToolCall，绕过主循环 createExecuteToolWrapper 的破坏性动作 hook 与 HITL 卡。委派执行里
 * **没有人类确认通道**——子代理暂停等确认的 UX 未接线，且不允许队友模型用 confirmParam 自我授权
 * 不可逆动作（红线A：模型不能自证同意）。故对委派语境采取"硬拦 + 要求升级回主 Agent"，而非弹确认卡。
 *
 * 返回 null = 放行（非破坏性工具 / 非破坏性分支）；返回 verdict = 硬拦。调用方应把它作为 policyGate
 * 结果返回（不计入失败熔断）。当前队友工具集经 registry curation 不含任何本表工具（由
 * smoke-teammate-tool-safety 钉死），本函数是纵深防御：防未来给队友加入破坏性工具、或模型幻觉出
 * 未暴露的破坏性工具（executeToolCall 按全局注册表执行、不做每-agent 允许集的执行层强制）。
 */
export function evaluateDelegatedToolSafetyBlock(toolName: string, params: any): ToolSafetyVerdict | null {
    const rule = TOOL_SAFETY_POLICY[toolName];
    if (!rule) return null;
    const destructive = rule.isDestructive ? rule.isDestructive(params) : true;
    if (!destructive) return null;
    return {
        blocked: true,
        toolName,
        class: rule.class,
        requiredConfirmParam: rule.confirmParam,
        message:
            `破坏性操作在委派执行中被安全策略硬拦：${toolName} —— ${rule.reason}。` +
            `设计队友（子代理）不具备执行不可逆动作的授权，委派中也没有人类确认通道，` +
            `即使调用自带 ${rule.confirmParam} 也不放行。请把该操作交回主流程，由主 Agent 在用户确认后执行；` +
            `或改用非破坏性方式（例如先 saveDocument 再关闭文档，或让用户自行完成外部敏感动作）。`
    };
}

/**
 * 安全策略当前拦截的工具名集合（TOOL_SAFETY_POLICY 的键）。
 * 单一事实源：供"委派队友 allowedTools 不得含被拦工具"这一不变量校验，避免另抄一份名单漂移。
 */
export function getSafetyGatedToolNames(): string[] {
    return Object.keys(TOOL_SAFETY_POLICY);
}

/**
 * 结果是否为"策略/安全控制信号"（而非真实工具执行失败）。
 * 通用循环据此把它排除出「连续失败熔断」与「no_progress 停机」的会计——控制重定向不是失败。
 * V0-1 治理核心：切断"策略否决被当失败放大成熔断/停机"这条链。
 */
export function isPolicyGateResult(result: any): boolean {
    return result != null && typeof result === 'object' && (result as { policyGate?: unknown }).policyGate === true;
}
