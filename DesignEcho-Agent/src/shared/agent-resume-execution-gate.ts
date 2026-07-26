import type { AgentResumePlanningResult } from './agent-resume-planning';
import { sanitizeAgentResumePlanningValue } from './agent-resume-planning';

export type AgentResumeExecutionGateVersion = 'agent-resume-execution-gate/v0';

export type AgentResumeExecutionGateStatus =
    | 'not_applicable'
    | 'blocked_resume_plan_not_available'
    | 'blocked_model_plan_parse_failed'
    | 'blocked_model_plan_requested_writes'
    | 'blocked_missing_executable_resume_plan'
    | 'blocked_missing_write_tool_whitelist'
    | 'blocked_write_tool_not_allowed'
    | 'blocked_missing_readback_targets'
    | 'blocked_pending_user_approval'
    | 'ready_for_approved_execution';

export const DEFAULT_AGENT_RESUME_WRITE_TOOL_ALLOWLIST = [
    'reorderLayer'
] as const;

export interface AgentResumeExecutionGateInput {
    planning?: AgentResumePlanningResult;
    allowedWriteTools?: string[];
    userApprovedExecution?: boolean;
}

export interface AgentResumeExecutionGate {
    version: AgentResumeExecutionGateVersion;
    status: AgentResumeExecutionGateStatus;
    planningStatus?: AgentResumePlanningResult['status'];
    writesPerformed: false;
    rawPayloadRedacted: true;
    shouldRunPhotoshop: false;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requiresExplicitUserApproval: true;
    requiresWriteToolWhitelist: true;
    requiresReadbackTargets: true;
    canDispatchWriteTools: boolean;
    userApprovedExecution: boolean;
    proposedWriteTools: string[];
    allowedWriteTools: string[];
    blockedWriteTools: string[];
    readbackTargets: string[];
    executionPlan?: unknown;
    blockers: string[];
    warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const output: string[] = [];
    for (const item of value) {
        const text = String(item || '').trim();
        if (!text || output.includes(text)) continue;
        output.push(text);
    }
    return output;
}

function normalizeStepToolNames(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const output: string[] = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        const toolName = String(item.toolName || item.tool || '').trim();
        if (!toolName || output.includes(toolName)) continue;
        output.push(toolName);
    }
    return output;
}

function getExecutionPlan(parsedModelPlan: unknown): Record<string, unknown> | undefined {
    if (!isRecord(parsedModelPlan)) return undefined;
    const directPlan = parsedModelPlan.proposedExecutionPlan || parsedModelPlan.executionPlan;
    return isRecord(directPlan) ? directPlan : undefined;
}

function buildGate(input: {
    planning?: AgentResumePlanningResult;
    status: AgentResumeExecutionGateStatus;
    canDispatchWriteTools?: boolean;
    userApprovedExecution?: boolean;
    proposedWriteTools?: string[];
    allowedWriteTools?: string[];
    blockedWriteTools?: string[];
    readbackTargets?: string[];
    executionPlan?: unknown;
    blockers?: string[];
    warnings?: string[];
}): AgentResumeExecutionGate {
    return {
        version: 'agent-resume-execution-gate/v0',
        status: input.status,
        planningStatus: input.planning?.status,
        writesPerformed: false,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: false,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiresExplicitUserApproval: true,
        requiresWriteToolWhitelist: true,
        requiresReadbackTargets: true,
        canDispatchWriteTools: input.canDispatchWriteTools === true,
        userApprovedExecution: input.userApprovedExecution === true,
        proposedWriteTools: input.proposedWriteTools || [],
        allowedWriteTools: input.allowedWriteTools || [],
        blockedWriteTools: input.blockedWriteTools || [],
        readbackTargets: input.readbackTargets || [],
        executionPlan: sanitizeAgentResumePlanningValue(input.executionPlan),
        blockers: input.blockers || [],
        warnings: input.warnings || []
    };
}

export function buildAgentResumeExecutionGate(
    input: AgentResumeExecutionGateInput
): AgentResumeExecutionGate {
    const planning = input.planning;
    const allowedWriteTools = normalizeStringList(input.allowedWriteTools);
    const userApprovedExecution = input.userApprovedExecution === true;

    if (!planning) {
        return buildGate({
            status: 'not_applicable',
            allowedWriteTools,
            userApprovedExecution,
            blockers: ['缺少恢复规划结果，不能进入恢复执行门禁。']
        });
    }

    if (planning.status !== 'model_resume_plan_available') {
        return buildGate({
            planning,
            status: planning.status === 'not_applicable' ? 'not_applicable' : 'blocked_resume_plan_not_available',
            allowedWriteTools,
            userApprovedExecution,
            blockers: planning.status === 'not_applicable'
                ? planning.blockers
                : [
                    ...planning.blockers,
                    '模型恢复计划尚不可用，不能进入写入型恢复执行。'
                ],
            warnings: planning.warnings
        });
    }

    const parsedPlan = planning.parsedModelPlan;
    if (!isRecord(parsedPlan)) {
        return buildGate({
            planning,
            status: 'blocked_model_plan_parse_failed',
            allowedWriteTools,
            userApprovedExecution,
            blockers: ['模型恢复计划不是可审查 JSON 对象，不能进入写入型恢复执行。'],
            warnings: planning.warnings
        });
    }

    if (parsedPlan.photoshopWritesAllowed !== false) {
        return buildGate({
            planning,
            status: 'blocked_model_plan_requested_writes',
            allowedWriteTools,
            userApprovedExecution,
            blockers: ['模型恢复计划没有明确保持 photoshopWritesAllowed=false，不能把模型计划直接升级为写入授权。'],
            warnings: planning.warnings
        });
    }

    const executionPlan = getExecutionPlan(parsedPlan);
    if (!executionPlan) {
        return buildGate({
            planning,
            status: 'blocked_missing_executable_resume_plan',
            allowedWriteTools,
            userApprovedExecution,
            blockers: ['模型恢复计划缺少 proposedExecutionPlan / executionPlan，不能进入写入型恢复执行。'],
            warnings: planning.warnings
        });
    }

    const stepWriteTools = normalizeStepToolNames(executionPlan.steps);
    const proposedWriteTools = normalizeStringList(executionPlan.writeToolWhitelist);
    const effectiveWriteTools = proposedWriteTools.length > 0 ? proposedWriteTools : stepWriteTools;
    if (effectiveWriteTools.length === 0) {
        return buildGate({
            planning,
            status: 'blocked_missing_write_tool_whitelist',
            allowedWriteTools,
            userApprovedExecution,
            executionPlan,
            blockers: ['恢复执行计划缺少 writeToolWhitelist，不能判断哪些 Photoshop 写工具被允许。'],
            warnings: planning.warnings
        });
    }

    const blockedWriteTools = effectiveWriteTools.filter((toolName) => !allowedWriteTools.includes(toolName));
    if (blockedWriteTools.length > 0) {
        return buildGate({
            planning,
            status: 'blocked_write_tool_not_allowed',
            allowedWriteTools,
            userApprovedExecution,
            proposedWriteTools: effectiveWriteTools,
            blockedWriteTools,
            executionPlan,
            blockers: blockedWriteTools.map((toolName) => `恢复执行计划包含未被运行时白名单允许的写工具：${toolName}`),
            warnings: planning.warnings
        });
    }

    const readbackTargets = normalizeStringList(executionPlan.readbackTargets);
    if (readbackTargets.length === 0) {
        return buildGate({
            planning,
            status: 'blocked_missing_readback_targets',
            allowedWriteTools,
            userApprovedExecution,
            proposedWriteTools: effectiveWriteTools,
            executionPlan,
            blockers: ['恢复执行计划缺少 readbackTargets，无法确定写入后如何读回验收。'],
            warnings: planning.warnings
        });
    }

    if (!userApprovedExecution) {
        return buildGate({
            planning,
            status: 'blocked_pending_user_approval',
            allowedWriteTools,
            userApprovedExecution,
            proposedWriteTools: effectiveWriteTools,
            readbackTargets,
            executionPlan,
            blockers: ['恢复执行计划已具备白名单和读回目标，但仍缺少用户明确执行确认。'],
            warnings: [
                ...planning.warnings,
                '默认仍不允许写入 Photoshop；需要用户确认后才可创建受控执行请求。'
            ]
        });
    }

    return buildGate({
        planning,
        status: 'ready_for_approved_execution',
        canDispatchWriteTools: true,
        allowedWriteTools,
        userApprovedExecution,
        proposedWriteTools: effectiveWriteTools,
        readbackTargets,
        executionPlan,
        warnings: [
            ...planning.warnings,
            '用户已确认恢复执行；该 gate 只允许后续受控 runner 根据白名单和读回目标执行，gate 本身不写 Photoshop。'
        ]
    });
}
