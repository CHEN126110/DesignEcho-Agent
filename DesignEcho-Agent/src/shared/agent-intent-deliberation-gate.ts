import type { AgentRequestLifecycleRecord } from './agent-request-lifecycle';

export type AgentIntentDeliberationGateVersion = 'agent-intent-deliberation-gate/v0';

export type AgentIntentDeliberationGateStatus =
    | 'model_selected'
    | 'deterministic_route_used'
    | 'clarify_first'
    | 'system_blocked'
    | 'model_unavailable_status'
    | 'needs_review';

export type AgentIntentDeliberationNextAction =
    | 'continue_execution'
    | 'ask_user_clarification'
    | 'respect_system_boundary'
    | 'review_route_source'
    | 'review_intent_decision';

export interface AgentIntentDeliberationGateObservedRoute {
    routeSource?: string;
    route?: string;
    skillId?: string;
    executionKind?: string;
    requiresPhotoshop?: boolean;
    canStart?: boolean;
    blockers: string[];
}

export interface AgentIntentDeliberationGate {
    version: AgentIntentDeliberationGateVersion;
    generatedAt: string;
    status: AgentIntentDeliberationGateStatus;
    nextAction: AgentIntentDeliberationNextAction;
    modelConsulted: boolean;
    nonModelDecisionUsed: boolean;
    diagnosticOnly: true;
    userVisible: false;
    canClaimModelReasoning: false;
    canClaimDesignQuality: false;
    mustNotChangeRouting: true;
    mustNotRunProvider: true;
    mustNotRunPhotoshop: true;
    observed: AgentIntentDeliberationGateObservedRoute;
    warnings: string[];
    limitations: string[];
}

export interface BuildAgentIntentDeliberationGateInput {
    lifecycle?: AgentRequestLifecycleRecord;
    generatedAt?: string;
}

function includesAny(value: string, terms: string[]): boolean {
    return terms.some((term) => value.includes(term));
}

function classifyGateStatus(
    lifecycle?: AgentRequestLifecycleRecord
): AgentIntentDeliberationGateStatus {
    if (!lifecycle) return 'needs_review';

    const source = lifecycle.decision.source;
    const route = lifecycle.decision.route;
    const reason = lifecycle.decision.reason || '';

    if (source === 'system') {
        return 'system_blocked';
    }
    if (source === 'intent_control_plane') {
        return route === 'clarification_needed' ? 'clarify_first' : 'needs_review';
    }
    if (route === 'clarification_needed') {
        return 'clarify_first';
    }
    if (source === 'model_router') {
        return 'model_selected';
    }
    if (source === 'deterministic_route' || source === 'local_route') {
        return 'deterministic_route_used';
    }
    if (
        source === 'lightweight_intent'
        && route === 'direct_response'
        && includesAny(reason, ['模型回复不可用', '没有得到有效对话回复', '使用本地回复', '本地回复'])
    ) {
        return 'model_unavailable_status';
    }

    return 'needs_review';
}

function resolveNextAction(
    status: AgentIntentDeliberationGateStatus
): AgentIntentDeliberationNextAction {
    switch (status) {
        case 'model_selected':
            return 'continue_execution';
        case 'clarify_first':
            return 'ask_user_clarification';
        case 'system_blocked':
            return 'respect_system_boundary';
        case 'deterministic_route_used':
        case 'model_unavailable_status':
            return 'review_route_source';
        case 'needs_review':
        default:
            return 'review_intent_decision';
    }
}

function didConsultModel(
    status: AgentIntentDeliberationGateStatus,
    lifecycle?: AgentRequestLifecycleRecord
): boolean {
    if (!lifecycle) return false;
    if (status === 'model_selected') return true;
    return status === 'clarify_first' && lifecycle.decision.source === 'model_router';
}

function didUseNonModelDecision(status: AgentIntentDeliberationGateStatus): boolean {
    return status === 'deterministic_route_used'
        || status === 'model_unavailable_status';
}

function collectLimitations(lifecycle?: AgentRequestLifecycleRecord): string[] {
    const limitations = [
        '这是隐藏诊断记录，只说明路由来源和执行边界，不代表 provider 原生推理内容。',
        '该记录不改变路由、不调用模型、不调用 Photoshop，也不能证明设计质量。'
    ];

    if (!lifecycle) {
        limitations.push('缺少请求生命周期记录，需要回看上游路由。');
    }

    return limitations;
}

function buildObservedRoute(
    lifecycle?: AgentRequestLifecycleRecord
): AgentIntentDeliberationGateObservedRoute {
    return {
        routeSource: lifecycle?.decision.source,
        route: lifecycle?.decision.route,
        skillId: lifecycle?.decision.skillId,
        executionKind: lifecycle?.execution.kind,
        requiresPhotoshop: lifecycle?.execution.requiresPhotoshop,
        canStart: lifecycle?.execution.canStart,
        blockers: Array.isArray(lifecycle?.blockers) ? lifecycle.blockers : []
    };
}

export function buildAgentIntentDeliberationGate(
    input: BuildAgentIntentDeliberationGateInput = {}
): AgentIntentDeliberationGate {
    const status = classifyGateStatus(input.lifecycle);

    return {
        version: 'agent-intent-deliberation-gate/v0',
        generatedAt: input.generatedAt || new Date().toISOString(),
        status,
        nextAction: resolveNextAction(status),
        modelConsulted: didConsultModel(status, input.lifecycle),
        nonModelDecisionUsed: didUseNonModelDecision(status),
        diagnosticOnly: true,
        userVisible: false,
        canClaimModelReasoning: false,
        canClaimDesignQuality: false,
        mustNotChangeRouting: true,
        mustNotRunProvider: true,
        mustNotRunPhotoshop: true,
        observed: buildObservedRoute(input.lifecycle),
        warnings: Array.isArray(input.lifecycle?.warnings) ? input.lifecycle.warnings : [],
        limitations: collectLimitations(input.lifecycle)
    };
}

export function isAgentIntentDeliberationGateBoundaryOk(
    gate: AgentIntentDeliberationGate
): boolean {
    return gate.version === 'agent-intent-deliberation-gate/v0'
        && gate.diagnosticOnly === true
        && gate.userVisible === false
        && gate.canClaimModelReasoning === false
        && gate.canClaimDesignQuality === false
        && gate.mustNotChangeRouting === true
        && gate.mustNotRunProvider === true
        && gate.mustNotRunPhotoshop === true;
}
