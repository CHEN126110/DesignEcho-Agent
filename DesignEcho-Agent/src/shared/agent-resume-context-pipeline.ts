/**
 * Agent resume readonly context pipeline.
 *
 * Merged from:
 * - agent-resume-context-gate.ts
 * - agent-resume-context-refresh-runner.ts
 * - agent-resume-readonly-context-executor.ts
 *
 * These three modules form a linear pipeline:
 *   gate (can we refresh?) → refresh-runner (what observations are needed?) → readonly-executor (call tools)
 */

import type { AgentResumeExecutionPolicy } from './agent-resume-execution-policy';

// ═══════════════════════════════════════════════════════════════════
// Part 1: Context Gate (from agent-resume-context-gate.ts)
// ═══════════════════════════════════════════════════════════════════

export type AgentResumeContextGateVersion = 'agent-resume-context-gate/v0';

export type AgentResumeContextGateStatus =
    | 'not_applicable'
    | 'blocked_policy_not_resumable'
    | 'blocked_missing_photoshop_connection'
    | 'blocked_missing_document'
    | 'ready_for_readonly_context_refresh'
    | 'ready_for_resume_planning';

export interface AgentResumeContextGateInput {
    policy: AgentResumeExecutionPolicy;
    photoshopConnected?: boolean;
    hasDocument?: boolean;
    documentName?: string;
    layerCount?: number;
    hasProject?: boolean;
    projectPath?: string;
    hasFreshPhotoshopSnapshot?: boolean;
    hasFreshProjectSnapshot?: boolean;
}

export interface AgentResumeContextGate {
    version: AgentResumeContextGateVersion;
    status: AgentResumeContextGateStatus;
    policyAction: AgentResumeExecutionPolicy['action'];
    canEnterResumePlanning: boolean;
    canRequestReadOnlyRefresh: boolean;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requiredObservations: string[];
    blockers: string[];
    warnings: string[];
    controlContextOnly: true;
    writesPerformed: false;
}

function hasResumeCandidatePolicy(policy: AgentResumeExecutionPolicy): boolean {
    return policy.action === 'resume_candidate_needs_model_decision'
        || policy.action === 'request_fresh_context_before_resume';
}

function buildGate(input: {
    policy: AgentResumeExecutionPolicy;
    status: AgentResumeContextGateStatus;
    canEnterResumePlanning?: boolean;
    canRequestReadOnlyRefresh?: boolean;
    requiredObservations?: string[];
    blockers?: string[];
    warnings?: string[];
}): AgentResumeContextGate {
    return {
        version: 'agent-resume-context-gate/v0',
        status: input.status,
        policyAction: input.policy.action,
        canEnterResumePlanning: input.canEnterResumePlanning === true,
        canRequestReadOnlyRefresh: input.canRequestReadOnlyRefresh === true,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiredObservations: input.requiredObservations || [],
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        controlContextOnly: true,
        writesPerformed: false
    };
}

export function buildAgentResumeContextGate(
    input: AgentResumeContextGateInput
): AgentResumeContextGate {
    if (!hasResumeCandidatePolicy(input.policy)) {
        return buildGate({
            policy: input.policy,
            status: input.policy.action === 'ignore' ? 'not_applicable' : 'blocked_policy_not_resumable',
            blockers: input.policy.blockers
        });
    }

    if (!input.photoshopConnected) {
        return buildGate({
            policy: input.policy,
            status: 'blocked_missing_photoshop_connection',
            blockers: ['Photoshop / UXP 当前未连接，不能读取恢复执行所需的上下文。'],
            requiredObservations: ['photoshop_connection']
        });
    }

    if (!input.hasDocument) {
        return buildGate({
            policy: input.policy,
            status: 'blocked_missing_document',
            blockers: ['当前没有打开的 Photoshop 文档，不能恢复上一轮 Photoshop 执行任务。'],
            requiredObservations: ['active_document']
        });
    }

    const requiredObservations = [
        'document_info',
        'document_snapshot',
        'layer_hierarchy',
        'acceptance_snapshot'
    ];

    if (input.hasProject || input.projectPath) {
        requiredObservations.push('project_context_snapshot');
    }

    const hasFreshPhotoshopSnapshot = input.hasFreshPhotoshopSnapshot === true;
    const hasFreshProjectSnapshot = input.hasFreshProjectSnapshot === true || (!input.hasProject && !input.projectPath);

    if (!hasFreshPhotoshopSnapshot || !hasFreshProjectSnapshot) {
        return buildGate({
            policy: input.policy,
            status: 'ready_for_readonly_context_refresh',
            canRequestReadOnlyRefresh: true,
            requiredObservations,
            warnings: [
                '可以请求只读上下文刷新，但仍禁止写入 Photoshop 或声明任务完成。'
            ]
        });
    }

    return buildGate({
        policy: input.policy,
        status: 'ready_for_resume_planning',
        canEnterResumePlanning: true,
        requiredObservations,
        warnings: [
            '只读上下文已就绪；下一步仍必须由模型生成明确恢复执行计划，不能直接写入。'
        ]
    });
}

// ═══════════════════════════════════════════════════════════════════
// Part 2: Context Refresh Runner (from agent-resume-context-refresh-runner.ts)
// ═══════════════════════════════════════════════════════════════════

export type AgentResumeContextRefreshRunVersion = 'agent-resume-context-refresh-runner/v0';

export type AgentResumeContextRefreshRunStatus =
    | 'not_applicable'
    | 'blocked_gate_not_refreshable'
    | 'waiting_for_readonly_observations'
    | 'partial_readonly_observations'
    | 'fresh_context_ready';

export type AgentResumeReadonlyObservationKey =
    | 'document_info'
    | 'document_snapshot'
    | 'layer_hierarchy'
    | 'acceptance_snapshot'
    | 'project_context_snapshot';

export interface AgentResumeReadonlyContext {
    documentInfo?: unknown;
    documentSnapshot?: unknown;
    layerHierarchy?: unknown;
    acceptanceSnapshot?: unknown;
    projectContextSnapshot?: unknown;
}

export interface AgentResumeContextRefreshRunInput {
    gate: AgentResumeContextGate;
    context?: AgentResumeReadonlyContext;
}

export interface AgentResumeContextRefreshRun {
    version: AgentResumeContextRefreshRunVersion;
    status: AgentResumeContextRefreshRunStatus;
    gateStatus: AgentResumeContextGate['status'];
    canEnterResumePlanning: boolean;
    canRequestReadOnlyRefresh: boolean;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requiredObservations: AgentResumeReadonlyObservationKey[];
    receivedObservations: AgentResumeReadonlyObservationKey[];
    missingObservations: AgentResumeReadonlyObservationKey[];
    allowedReadOnlyTools: string[];
    blockers: string[];
    warnings: string[];
    controlContextOnly: true;
    writesPerformed: false;
    rawPayloadRedacted: true;
}

const READONLY_TOOL_BY_OBSERVATION: Record<AgentResumeReadonlyObservationKey, string> = {
    document_info: 'getDocumentInfo',
    document_snapshot: 'getDocumentSnapshot',
    layer_hierarchy: 'getLayerHierarchy',
    acceptance_snapshot: 'getAcceptanceSnapshot',
    project_context_snapshot: 'getProjectContextSnapshot'
};

const CONTEXT_PROPERTY_BY_OBSERVATION: Record<AgentResumeReadonlyObservationKey, keyof AgentResumeReadonlyContext> = {
    document_info: 'documentInfo',
    document_snapshot: 'documentSnapshot',
    layer_hierarchy: 'layerHierarchy',
    acceptance_snapshot: 'acceptanceSnapshot',
    project_context_snapshot: 'projectContextSnapshot'
};

function isReadonlyObservationKey(value: string): value is AgentResumeReadonlyObservationKey {
    return Object.prototype.hasOwnProperty.call(READONLY_TOOL_BY_OBSERVATION, value);
}

function normalizeRequiredObservations(values: string[]): AgentResumeReadonlyObservationKey[] {
    const output: AgentResumeReadonlyObservationKey[] = [];
    for (const value of values) {
        if (!isReadonlyObservationKey(value)) continue;
        if (output.includes(value)) continue;
        output.push(value);
    }
    return output;
}

function hasContextObservation(
    context: AgentResumeReadonlyContext | undefined,
    key: AgentResumeReadonlyObservationKey
): boolean {
    if (!context) return false;
    const property = CONTEXT_PROPERTY_BY_OBSERVATION[key];
    return Object.prototype.hasOwnProperty.call(context, property) && context[property] != null;
}

function buildRun(input: {
    gate: AgentResumeContextGate;
    status: AgentResumeContextRefreshRunStatus;
    canEnterResumePlanning?: boolean;
    canRequestReadOnlyRefresh?: boolean;
    requiredObservations?: AgentResumeReadonlyObservationKey[];
    receivedObservations?: AgentResumeReadonlyObservationKey[];
    missingObservations?: AgentResumeReadonlyObservationKey[];
    blockers?: string[];
    warnings?: string[];
}): AgentResumeContextRefreshRun {
    const requiredObservations = input.requiredObservations || [];
    return {
        version: 'agent-resume-context-refresh-runner/v0',
        status: input.status,
        gateStatus: input.gate.status,
        canEnterResumePlanning: input.canEnterResumePlanning === true,
        canRequestReadOnlyRefresh: input.canRequestReadOnlyRefresh === true,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiredObservations,
        receivedObservations: input.receivedObservations || [],
        missingObservations: input.missingObservations || [],
        allowedReadOnlyTools: requiredObservations.map((key) => READONLY_TOOL_BY_OBSERVATION[key]),
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        controlContextOnly: true,
        writesPerformed: false,
        rawPayloadRedacted: true
    };
}

export function buildAgentResumeContextRefreshRun(
    input: AgentResumeContextRefreshRunInput
): AgentResumeContextRefreshRun {
    const requiredObservations = normalizeRequiredObservations(input.gate.requiredObservations);

    if (input.gate.status === 'not_applicable') {
        return buildRun({
            gate: input.gate,
            status: 'not_applicable',
            blockers: input.gate.blockers,
            warnings: input.gate.warnings
        });
    }

    if (input.gate.status === 'ready_for_resume_planning') {
        return buildRun({
            gate: input.gate,
            status: 'fresh_context_ready',
            canEnterResumePlanning: true,
            requiredObservations,
            receivedObservations: requiredObservations,
            warnings: [
                ...input.gate.warnings,
                '只读上下文已由 gate 判定为新鲜；仍必须由模型生成明确恢复计划后才能写入。'
            ]
        });
    }

    if (input.gate.status !== 'ready_for_readonly_context_refresh') {
        return buildRun({
            gate: input.gate,
            status: 'blocked_gate_not_refreshable',
            requiredObservations,
            blockers: input.gate.blockers.length > 0
                ? input.gate.blockers
                : ['当前 gate 不允许请求只读上下文刷新。'],
            warnings: input.gate.warnings
        });
    }

    const receivedObservations = requiredObservations.filter((key) => hasContextObservation(input.context, key));
    const missingObservations = requiredObservations.filter((key) => !receivedObservations.includes(key));

    if (receivedObservations.length === 0) {
        return buildRun({
            gate: input.gate,
            status: 'waiting_for_readonly_observations',
            canRequestReadOnlyRefresh: true,
            requiredObservations,
            missingObservations,
            warnings: [
                ...input.gate.warnings,
                '尚未收到所需的只读观察结果；不能进入恢复执行规划。'
            ]
        });
    }

    if (missingObservations.length > 0) {
        return buildRun({
            gate: input.gate,
            status: 'partial_readonly_observations',
            canRequestReadOnlyRefresh: true,
            requiredObservations,
            receivedObservations,
            missingObservations,
            warnings: [
                ...input.gate.warnings,
                '只读观察结果不完整；不能把部分上下文当作可恢复执行依据。'
            ]
        });
    }

    return buildRun({
        gate: input.gate,
        status: 'fresh_context_ready',
        canEnterResumePlanning: true,
        requiredObservations,
        receivedObservations,
        warnings: [
            ...input.gate.warnings,
            '只读上下文观察已齐备；下一步仍只允许进入模型恢复规划，不能直接写入 Photoshop。'
        ]
    });
}

// ═══════════════════════════════════════════════════════════════════
// Part 3: Readonly Context Executor (from agent-resume-readonly-context-executor.ts)
// ═══════════════════════════════════════════════════════════════════

export type AgentResumeReadonlyContextExecutorVersion = 'agent-resume-readonly-context-executor/v0';

export type AgentResumeReadonlyContextExecutorStatus =
    | 'not_applicable'
    | 'blocked_refresh_run_not_ready'
    | 'blocked_missing_readonly_tools'
    | 'completed_readonly_refresh'
    | 'failed_readonly_refresh';

export type AgentResumeReadonlyToolName =
    | 'getDocumentInfo'
    | 'getDocumentSnapshot'
    | 'getLayerHierarchy'
    | 'getAcceptanceSnapshot'
    | 'getProjectContextSnapshot';

export interface AgentResumeReadonlyToolResult {
    ok: boolean;
    observationKey: AgentResumeReadonlyObservationKey;
    toolName: AgentResumeReadonlyToolName;
    error?: string;
}

export type AgentResumeReadonlyToolHandlers = Partial<Record<
    AgentResumeReadonlyToolName,
    () => unknown | Promise<unknown>
>>;

export interface AgentResumeReadonlyContextExecutorInput {
    refreshRun: AgentResumeContextRefreshRun;
    tools?: AgentResumeReadonlyToolHandlers;
}

export interface AgentResumeReadonlyContextExecutorResult {
    version: AgentResumeReadonlyContextExecutorVersion;
    status: AgentResumeReadonlyContextExecutorStatus;
    controlContextOnly: true;
    writesPerformed: false;
    rawPayloadRedacted: true;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requestedTools: AgentResumeReadonlyToolName[];
    completedTools: AgentResumeReadonlyToolName[];
    missingTools: AgentResumeReadonlyToolName[];
    failedTools: AgentResumeReadonlyToolResult[];
    readonlyToolResults: AgentResumeReadonlyToolResult[];
    context?: AgentResumeReadonlyContext;
    blockers: string[];
    warnings: string[];
}

const OBSERVATION_KEY_BY_TOOL: Record<AgentResumeReadonlyToolName, AgentResumeReadonlyObservationKey> = {
    getDocumentInfo: 'document_info',
    getDocumentSnapshot: 'document_snapshot',
    getLayerHierarchy: 'layer_hierarchy',
    getAcceptanceSnapshot: 'acceptance_snapshot',
    getProjectContextSnapshot: 'project_context_snapshot'
};

const CONTEXT_PROPERTY_BY_TOOL: Record<AgentResumeReadonlyToolName, keyof AgentResumeReadonlyContext> = {
    getDocumentInfo: 'documentInfo',
    getDocumentSnapshot: 'documentSnapshot',
    getLayerHierarchy: 'layerHierarchy',
    getAcceptanceSnapshot: 'acceptanceSnapshot',
    getProjectContextSnapshot: 'projectContextSnapshot'
};

function isReadonlyToolName(value: string): value is AgentResumeReadonlyToolName {
    return Object.prototype.hasOwnProperty.call(OBSERVATION_KEY_BY_TOOL, value);
}

function normalizeRequestedTools(refreshRun: AgentResumeContextRefreshRun): AgentResumeReadonlyToolName[] {
    const output: AgentResumeReadonlyToolName[] = [];
    for (const toolName of refreshRun.allowedReadOnlyTools) {
        if (!isReadonlyToolName(toolName)) continue;
        if (output.includes(toolName)) continue;
        output.push(toolName);
    }
    return output;
}

function buildExecutorResult(input: {
    status: AgentResumeReadonlyContextExecutorStatus;
    requestedTools?: AgentResumeReadonlyToolName[];
    completedTools?: AgentResumeReadonlyToolName[];
    missingTools?: AgentResumeReadonlyToolName[];
    failedTools?: AgentResumeReadonlyToolResult[];
    readonlyToolResults?: AgentResumeReadonlyToolResult[];
    context?: AgentResumeReadonlyContext;
    blockers?: string[];
    warnings?: string[];
}): AgentResumeReadonlyContextExecutorResult {
    return {
        version: 'agent-resume-readonly-context-executor/v0',
        status: input.status,
        controlContextOnly: true,
        writesPerformed: false,
        rawPayloadRedacted: true,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requestedTools: input.requestedTools || [],
        completedTools: input.completedTools || [],
        missingTools: input.missingTools || [],
        failedTools: input.failedTools || [],
        readonlyToolResults: input.readonlyToolResults || [],
        context: input.context,
        blockers: input.blockers || [],
        warnings: input.warnings || []
    };
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return '只读上下文工具执行失败。';
}

export async function runAgentResumeReadonlyContextExecutor(
    input: AgentResumeReadonlyContextExecutorInput
): Promise<AgentResumeReadonlyContextExecutorResult> {
    if (input.refreshRun.status === 'not_applicable') {
        return buildExecutorResult({
            status: 'not_applicable',
            blockers: input.refreshRun.blockers,
            warnings: input.refreshRun.warnings
        });
    }

    if (!input.refreshRun.canRequestReadOnlyRefresh) {
        return buildExecutorResult({
            status: 'blocked_refresh_run_not_ready',
            blockers: input.refreshRun.blockers.length > 0
                ? input.refreshRun.blockers
                : ['当前 refresh runner 不允许执行只读上下文刷新。'],
            warnings: input.refreshRun.warnings
        });
    }

    const requestedTools = normalizeRequestedTools(input.refreshRun);
    const toolHandlers = input.tools || {};
    const missingTools = requestedTools.filter((toolName) => typeof toolHandlers[toolName] !== 'function');

    if (missingTools.length > 0) {
        return buildExecutorResult({
            status: 'blocked_missing_readonly_tools',
            requestedTools,
            missingTools,
            blockers: missingTools.map((toolName) => `缺少只读工具处理器：${toolName}`),
            warnings: input.refreshRun.warnings
        });
    }

    const context: AgentResumeReadonlyContext = {};
    const completedTools: AgentResumeReadonlyToolName[] = [];
    const failedTools: AgentResumeReadonlyToolResult[] = [];
    const readonlyToolResults: AgentResumeReadonlyToolResult[] = [];

    for (const toolName of requestedTools) {
        const handler = toolHandlers[toolName];
        if (!handler) continue;

        const observationKey = OBSERVATION_KEY_BY_TOOL[toolName];
        try {
            const value = await handler();
            context[CONTEXT_PROPERTY_BY_TOOL[toolName]] = value;
            completedTools.push(toolName);
            readonlyToolResults.push({
                ok: true,
                observationKey,
                toolName
            });
        } catch (error) {
            const failedTool = {
                ok: false,
                observationKey,
                toolName,
                error: normalizeError(error)
            };
            failedTools.push(failedTool);
            readonlyToolResults.push(failedTool);
            return buildExecutorResult({
                status: 'failed_readonly_refresh',
                requestedTools,
                completedTools,
                failedTools,
                readonlyToolResults,
                context,
                blockers: [`只读上下文刷新失败：${toolName}。${failedTool.error}`],
                warnings: input.refreshRun.warnings
            });
        }
    }

    return buildExecutorResult({
        status: 'completed_readonly_refresh',
        requestedTools,
        completedTools,
        readonlyToolResults,
        context,
        warnings: [
            ...input.refreshRun.warnings,
            '只读上下文刷新已完成；该结果仍不能直接触发 Photoshop 写入或任务完成声明。'
        ]
    });
}
