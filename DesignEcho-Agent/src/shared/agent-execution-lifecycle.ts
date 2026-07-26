import type {
    AgentRequestLifecycleRecord,
    AgentRequestRoute
} from './agent-request-lifecycle';

export type AgentExecutionLifecycleVersion = 'agent-execution-lifecycle/v0';

export type AgentExecutionLifecyclePhase =
    | 'routing'
    | 'waiting_for_context'
    | 'responding'
    | 'executing_skill'
    | 'executing_autonomous_agent'
    | 'executing_tools'
    | 'verifying'
    | 'completed'
    | 'needs_review'
    | 'awaiting_confirmation'
    | 'failed'
    | 'cancelled';

export type AgentExecutionLifecycleStatus =
    | 'running'
    | 'completed'
    | 'needs_review'
    | 'awaiting_confirmation'
    | 'failed'
    | 'cancelled';

export type AgentExecutionActorKind =
    | 'router'
    | 'skill'
    | 'autonomous_agent'
    | 'model'
    | 'tool'
    | 'unknown';

export interface AgentVisibleActivityLike {
    kind?: string;
    agentId?: string;
    agentLabel?: string;
}

export interface AgentExecutionLifecycleSnapshot {
    version: AgentExecutionLifecycleVersion;
    phase: AgentExecutionLifecyclePhase;
    status: AgentExecutionLifecycleStatus;
    statusLabel: string;
    generatedAt: string;
    projectionOnly: true;
    userVisible: true;
    isProviderThinking: false;
    canClaimModelReasoning: false;
    canClaimTaskCompletion: false;
    mustNotRunProvider: true;
    mustNotRunPhotoshop: true;
    actor: {
        kind: AgentExecutionActorKind;
        id: string;
        label: string;
    };
    route: {
        route?: AgentRequestRoute;
        routeSource?: string;
        skillId?: string;
        executionKind?: string;
        requiresPhotoshop?: boolean;
        canStart?: boolean;
    };
    toolState: {
        toolCallCount: number;
        activeToolName?: string;
    };
    blockers: string[];
    warnings: string[];
    requiredNextConditions: string[];
    limitations: string[];
}

export interface BuildAgentExecutionLifecycleSnapshotInput {
    lifecycle?: AgentRequestLifecycleRecord;
    visibleActivity?: AgentVisibleActivityLike;
    status?: AgentExecutionLifecycleStatus;
    toolCallCount?: number;
    activeToolName?: string;
    blockers?: string[];
    warnings?: string[];
    generatedAt?: string;
}

export function buildAgentExecutionLifecycleSnapshot(
    input: BuildAgentExecutionLifecycleSnapshotInput
): AgentExecutionLifecycleSnapshot {
    const lifecycle = input.lifecycle;
    const blockers = collectBlockers(input);
    const warnings = collectWarnings(input);
    const toolCallCount = normalizeCount(input.toolCallCount);
    const activeToolName = normalizeText(input.activeToolName);
    const status = input.status || 'running';
    const phase = derivePhase({
        lifecycle,
        status,
        blockers,
        toolCallCount,
        activeToolName
    });

    return {
        version: 'agent-execution-lifecycle/v0',
        phase,
        status,
        statusLabel: getStatusLabel(phase),
        generatedAt: input.generatedAt || new Date().toISOString(),
        projectionOnly: true,
        userVisible: true,
        isProviderThinking: false,
        canClaimModelReasoning: false,
        canClaimTaskCompletion: false,
        mustNotRunProvider: true,
        mustNotRunPhotoshop: true,
        actor: buildActor(input.visibleActivity, lifecycle, activeToolName, phase),
        route: {
            route: lifecycle?.decision.route,
            routeSource: lifecycle?.decision.source,
            skillId: lifecycle?.decision.skillId,
            executionKind: lifecycle?.execution.kind,
            requiresPhotoshop: lifecycle?.execution.requiresPhotoshop,
            canStart: lifecycle?.execution.canStart
        },
        toolState: {
            toolCallCount,
            activeToolName: activeToolName || undefined
        },
        blockers,
        warnings,
        requiredNextConditions: buildRequiredNextConditions(phase, lifecycle, blockers),
        limitations: [
            '该 snapshot 只消费已有 lifecycle、可见执行单元和工具事件计数。',
            '该 snapshot 不调用模型、不执行 Photoshop、不证明设计质量。',
            '该 snapshot 是用户可见执行状态，不是 provider thinking 或私有 chain-of-thought。'
        ]
    };
}

export function isAgentExecutionLifecycleBoundaryOk(
    snapshot: AgentExecutionLifecycleSnapshot | undefined
): boolean | undefined {
    if (!snapshot) return undefined;
    return snapshot.projectionOnly === true
        && snapshot.userVisible === true
        && snapshot.isProviderThinking === false
        && snapshot.canClaimModelReasoning === false
        && snapshot.canClaimTaskCompletion === false
        && snapshot.mustNotRunProvider === true
        && snapshot.mustNotRunPhotoshop === true;
}

function derivePhase(input: {
    lifecycle?: AgentRequestLifecycleRecord;
    status: AgentExecutionLifecycleStatus;
    blockers: string[];
    toolCallCount: number;
    activeToolName: string;
}): AgentExecutionLifecyclePhase {
    if (input.status === 'cancelled') return 'cancelled';
    if (input.status === 'failed') return 'failed';
    if (input.status === 'awaiting_confirmation') return 'awaiting_confirmation';
    if (input.status === 'needs_review') return 'needs_review';
    if (input.status === 'completed') return 'completed';
    if (!input.lifecycle) return 'routing';
    if (input.blockers.length > 0 || input.lifecycle.execution.canStart === false) {
        return 'waiting_for_context';
    }
    if (input.activeToolName || input.toolCallCount > 0) return 'executing_tools';
    if (input.lifecycle.decision.route === 'direct_response') return 'responding';
    if (input.lifecycle.decision.route === 'clarification_needed') return 'waiting_for_context';
    if (input.lifecycle.decision.route === 'autonomous_agent') return 'executing_autonomous_agent';
    if (input.lifecycle.execution.kind === 'deterministic_skill') return 'executing_skill';
    return 'routing';
}

function buildActor(
    visibleActivity: AgentVisibleActivityLike | undefined,
    lifecycle: AgentRequestLifecycleRecord | undefined,
    activeToolName: string,
    phase: AgentExecutionLifecyclePhase
): AgentExecutionLifecycleSnapshot['actor'] {
    if (activeToolName) {
        return {
            kind: 'tool',
            id: activeToolName,
            label: activeToolName
        };
    }

    const visibleId = normalizeText(visibleActivity?.agentId);
    const visibleLabel = normalizeText(visibleActivity?.agentLabel);
    if (visibleId || visibleLabel) {
        return {
            kind: normalizeActorKind(visibleActivity?.kind),
            id: visibleId || visibleLabel,
            label: visibleLabel || visibleId || 'Agent'
        };
    }

    const skillId = normalizeText(lifecycle?.decision.skillId);
    if (skillId) {
        return {
            kind: skillId === 'autonomous-agent' ? 'autonomous_agent' : 'skill',
            id: skillId,
            label: skillId
        };
    }

    if (phase === 'responding' || lifecycle?.decision.route === 'direct_response') {
        return {
            kind: 'model',
            id: 'model-response',
            label: 'Model Response'
        };
    }

    return {
        kind: 'router',
        id: 'agent-router',
        label: 'Agent Router'
    };
}

function normalizeActorKind(value: unknown): AgentExecutionActorKind {
    const text = normalizeText(value);
    if (text === 'router') return 'router';
    if (text === 'skill') return 'skill';
    if (text === 'autonomous_agent') return 'autonomous_agent';
    if (text === 'model') return 'model';
    if (text === 'tool') return 'tool';
    return 'unknown';
}

function getStatusLabel(phase: AgentExecutionLifecyclePhase): string {
    switch (phase) {
        case 'routing':
            return '识别执行路径';
        case 'waiting_for_context':
            return '等待上下文';
        case 'responding':
            return '生成回复';
        case 'executing_skill':
            return '执行确定性能力';
        case 'executing_autonomous_agent':
            return '执行自主 Agent';
        case 'executing_tools':
            return '执行工具';
        case 'verifying':
            return '验收结果';
        case 'completed':
            return '已完成';
        case 'needs_review':
            return '需要复核';
        case 'awaiting_confirmation':
            return '等待确认';
        case 'failed':
            return '失败';
        case 'cancelled':
            return '已取消';
        default:
            return '执行中';
    }
}

function buildRequiredNextConditions(
    phase: AgentExecutionLifecyclePhase,
    lifecycle: AgentRequestLifecycleRecord | undefined,
    blockers: string[]
): string[] {
    if (!lifecycle) return ['agent_request_lifecycle_required'];
    if (blockers.length > 0 || phase === 'waiting_for_context') return ['context_or_user_decision_required'];
    if (phase === 'executing_skill') return ['skill_or_tool_event_required'];
    if (phase === 'executing_autonomous_agent') return ['autonomous_agent_step_or_tool_event_required'];
    if (phase === 'executing_tools') return ['tool_result_or_verification_required'];
    if (phase === 'completed') return [];
    if (phase === 'needs_review') return ['review_or_followup_required'];
    if (phase === 'awaiting_confirmation') return ['user_confirmation_required'];
    if (phase === 'failed') return ['failure_diagnostic_required'];
    return ['next_lifecycle_event_required'];
}

function collectBlockers(input: BuildAgentExecutionLifecycleSnapshotInput): string[] {
    return uniqueStrings([
        ...normalizeStringArray(input.blockers),
        ...normalizeStringArray(input.lifecycle?.blockers)
    ]);
}

function collectWarnings(input: BuildAgentExecutionLifecycleSnapshotInput): string[] {
    return uniqueStrings([
        ...normalizeStringArray(input.warnings),
        ...normalizeStringArray(input.lifecycle?.warnings)
    ]);
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCount(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeText(item))
        .filter(Boolean);
}

function uniqueStrings(value: string[]): string[] {
    return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}
