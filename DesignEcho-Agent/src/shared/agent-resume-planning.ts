import type { AgentResumableTaskContract } from './agent-resumable-task-contract';
import type { AgentResumeExecutionPolicy } from './agent-resume-execution-policy';
import type { AgentResumeContextGate, AgentResumeContextRefreshRun, AgentResumeReadonlyContext, AgentResumeReadonlyContextExecutorResult } from './agent-resume-context-pipeline';

export type AgentResumePlanningVersion = 'agent-resume-planning/v0';

export type AgentResumePlanningStatus =
    | 'not_applicable'
    | 'blocked_readonly_context_not_ready'
    | 'ready_for_model_resume_plan'
    | 'model_resume_plan_available'
    | 'model_resume_plan_failed';

export interface AgentResumePlanningResult {
    version: AgentResumePlanningVersion;
    status: AgentResumePlanningStatus;
    controlContextOnly: true;
    writesPerformed: false;
    rawPayloadRedacted: true;
    shouldRunPhotoshop: false;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requiresExplicitExecutionApproval: true;
    contractStatus: AgentResumableTaskContract['status'];
    policyAction: AgentResumeExecutionPolicy['action'];
    gateStatus: AgentResumeContextGate['status'];
    readonlyContextStatus: AgentResumeContextRefreshRun['status'];
    readonlyExecutorStatus?: AgentResumeReadonlyContextExecutorResult['status'];
    modelPurpose?: 'resume_planning';
    previousUserInput?: string;
    previousSkillId?: string;
    modelPlanText?: string;
    parsedModelPlan?: unknown;
    blockers: string[];
    warnings: string[];
}

export interface AgentResumePlanningInput {
    contract: AgentResumableTaskContract;
    policy: AgentResumeExecutionPolicy;
    gate: AgentResumeContextGate;
    refreshRun: AgentResumeContextRefreshRun;
    readonlyExecutor?: AgentResumeReadonlyContextExecutorResult;
    modelPlanText?: string;
    modelError?: unknown;
}

export interface AgentResumePlanningPromptInput {
    contract: AgentResumableTaskContract;
    policy: AgentResumeExecutionPolicy;
    gate: AgentResumeContextGate;
    refreshRun: AgentResumeContextRefreshRun;
    readonlyExecutor?: AgentResumeReadonlyContextExecutorResult;
}

const MAX_STRING_LENGTH = 900;
const MAX_ARRAY_ITEMS = 16;
const MAX_OBJECT_DEPTH = 5;

function trimText(value: unknown, limit = MAX_STRING_LENGTH): string {
    const text = String(value || '').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}...[truncated]`;
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return '模型恢复规划调用失败。';
}

function parseJsonBlock(text: string): unknown {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;

    try {
        return JSON.parse(candidate);
    } catch {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(candidate.slice(start, end + 1));
            } catch {
                return undefined;
            }
        }
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRawPayloadKey(key: string): boolean {
    const normalized = key.toLowerCase();
    if (normalized === 'rawpayloadredacted') return false;
    return normalized.includes('base64')
        || normalized.includes('imagedata')
        || normalized.includes('rawimage')
        || normalized.includes('rawpayload')
        || normalized.includes('binary')
        || normalized.includes('buffer');
}

export function sanitizeAgentResumePlanningValue(value: unknown, depth = 0): unknown {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'string') return trimText(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= MAX_OBJECT_DEPTH) return '[redacted:max-depth]';

    if (Array.isArray(value)) {
        return value
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => sanitizeAgentResumePlanningValue(item, depth + 1));
    }

    if (!isRecord(value)) return String(value);

    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (isRawPayloadKey(key)) {
            output[key] = '[redacted]';
            continue;
        }
        const sanitized = sanitizeAgentResumePlanningValue(nestedValue, depth + 1);
        if (sanitized !== undefined) {
            output[key] = sanitized;
        }
    }
    return output;
}

function buildPlanningResult(input: {
    status: AgentResumePlanningStatus;
    contract: AgentResumableTaskContract;
    policy: AgentResumeExecutionPolicy;
    gate: AgentResumeContextGate;
    refreshRun: AgentResumeContextRefreshRun;
    readonlyExecutor?: AgentResumeReadonlyContextExecutorResult;
    modelPlanText?: string;
    parsedModelPlan?: unknown;
    blockers?: string[];
    warnings?: string[];
}): AgentResumePlanningResult {
    return {
        version: 'agent-resume-planning/v0',
        status: input.status,
        controlContextOnly: true,
        writesPerformed: false,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: false,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiresExplicitExecutionApproval: true,
        contractStatus: input.contract.status,
        policyAction: input.policy.action,
        gateStatus: input.gate.status,
        readonlyContextStatus: input.refreshRun.status,
        readonlyExecutorStatus: input.readonlyExecutor?.status,
        modelPurpose: input.status === 'model_resume_plan_available' || input.status === 'model_resume_plan_failed'
            ? 'resume_planning'
            : undefined,
        previousUserInput: input.contract.previousUserInput,
        previousSkillId: input.contract.previousSkillId,
        modelPlanText: input.modelPlanText,
        parsedModelPlan: input.parsedModelPlan,
        blockers: input.blockers || [],
        warnings: input.warnings || []
    };
}

export function buildAgentResumePlanningResult(
    input: AgentResumePlanningInput
): AgentResumePlanningResult {
    if (input.policy.action !== 'resume_candidate_needs_model_decision'
        && input.policy.action !== 'request_fresh_context_before_resume') {
        return buildPlanningResult({
            status: 'not_applicable',
            contract: input.contract,
            policy: input.policy,
            gate: input.gate,
            refreshRun: input.refreshRun,
            readonlyExecutor: input.readonlyExecutor,
            blockers: input.policy.blockers,
            warnings: input.policy.warnings
        });
    }

    if (!input.refreshRun.canEnterResumePlanning) {
        return buildPlanningResult({
            status: 'blocked_readonly_context_not_ready',
            contract: input.contract,
            policy: input.policy,
            gate: input.gate,
            refreshRun: input.refreshRun,
            readonlyExecutor: input.readonlyExecutor,
            blockers: [
                ...input.refreshRun.blockers,
                ...(input.readonlyExecutor?.blockers || []),
                '只读上下文尚未齐备，不能请求模型生成恢复执行计划。'
            ],
            warnings: [
                ...input.refreshRun.warnings,
                ...(input.readonlyExecutor?.warnings || [])
            ]
        });
    }

    const rawPlan = trimText(input.modelPlanText);
    if (input.modelError) {
        return buildPlanningResult({
            status: 'model_resume_plan_failed',
            contract: input.contract,
            policy: input.policy,
            gate: input.gate,
            refreshRun: input.refreshRun,
            readonlyExecutor: input.readonlyExecutor,
            blockers: [`模型恢复规划失败：${normalizeError(input.modelError)}`],
            warnings: [
                ...input.refreshRun.warnings,
                '只读上下文已齐备，但模型恢复规划失败；仍不能写入 Photoshop。'
            ]
        });
    }

    if (!rawPlan) {
        return buildPlanningResult({
            status: 'ready_for_model_resume_plan',
            contract: input.contract,
            policy: input.policy,
            gate: input.gate,
            refreshRun: input.refreshRun,
            readonlyExecutor: input.readonlyExecutor,
            warnings: [
                ...input.refreshRun.warnings,
                '只读上下文已齐备，等待模型生成恢复计划；仍不能直接写入 Photoshop。'
            ]
        });
    }

    return buildPlanningResult({
        status: 'model_resume_plan_available',
        contract: input.contract,
        policy: input.policy,
        gate: input.gate,
        refreshRun: input.refreshRun,
        readonlyExecutor: input.readonlyExecutor,
        modelPlanText: rawPlan,
        parsedModelPlan: sanitizeAgentResumePlanningValue(parseJsonBlock(rawPlan)),
        warnings: [
            ...input.refreshRun.warnings,
            '模型已生成恢复计划；该计划只允许作为下一步执行决策依据，不能自动写入 Photoshop。'
        ]
    });
}

export function buildAgentResumePlanningMessages(
    input: AgentResumePlanningPromptInput
): Array<{ role: 'system' | 'user'; content: string }> {
    const readonlyContext: AgentResumeReadonlyContext | undefined = input.readonlyExecutor?.context;
    const payload = {
        previousUserInput: input.contract.previousUserInput,
        previousSkillId: input.contract.previousSkillId,
        contractStatus: input.contract.status,
        policyAction: input.policy.action,
        gateStatus: input.gate.status,
        refreshRunStatus: input.refreshRun.status,
        receivedObservations: input.refreshRun.receivedObservations,
        readonlyToolResults: input.readonlyExecutor?.readonlyToolResults,
        readonlyContext: sanitizeAgentResumePlanningValue(readonlyContext)
    };

    return [
        {
            role: 'system',
            content: [
                '你是 DesignEcho Agent 的恢复规划器。',
                '你只能基于给定的只读上下文生成公开、可审查的恢复计划。',
                '禁止声明任务已经完成，禁止要求或模拟 Photoshop 写入，禁止输出工具调用。',
                '输出必须是 JSON，不要包含 Markdown。'
            ].join('\n')
        },
        {
            role: 'user',
            content: [
                '请为“继续”请求生成恢复计划。',
                '要求：',
                '1. planSummary：一句话说明将从哪里恢复。',
                '2. readonlyFindings：列出 2 到 5 条只读上下文事实。',
                '3. nextAction：下一步建议，应是等待明确执行确认或生成可审查执行计划。',
                '4. photoshopWritesAllowed 必须为 false。',
                '5. 不要把 fresh_context_ready 解释成任务完成。',
                '6. proposedExecutionPlan：如果只读观察与上下文足够，给出可审查执行计划对象；必须包含 objective、steps、writeToolWhitelist、readbackTargets、requiresUserApproval=true。',
                '7. proposedExecutionPlan 只是等待用户确认的计划，不是执行授权；不能要求现在写 Photoshop。',
                '',
                JSON.stringify(payload, null, 2)
            ].join('\n')
        }
    ];
}
