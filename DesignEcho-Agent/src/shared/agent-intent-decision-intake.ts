import type {
    AgentAcceptanceCase,
    AgentAcceptanceExecutionSummary,
    AgentAcceptanceToolEvent
} from './agent-acceptance-contracts';
import type { AgentRequestLifecycleRecord } from './agent-request-lifecycle';

export type AgentIntentDecisionIntakeVersion = 'agent-intent-decision-intake/v0';

export type AgentIntentDecisionIntakeStatus =
    | 'missing_lifecycle'
    | 'chat_only'
    | 'deterministic_skill_ready'
    | 'autonomous_needs_review'
    | 'blocked_or_missing_context'
    | 'route_mismatch'
    | 'tool_usage_mismatch'
    | 'needs_review';

export interface AgentIntentDecisionIntake {
    version: AgentIntentDecisionIntakeVersion;
    status: AgentIntentDecisionIntakeStatus;
    generatedAt: string;
    reviewOnly: true;
    userVisible: false;
    canClaimDesignQuality: false;
    mustNotChangeRouting: true;
    mustNotRunProvider: true;
    mustNotRunPhotoshop: true;
    observed: {
        route?: string;
        routeSource?: string;
        skillId?: string;
        executionKind?: string;
        requiresPhotoshop?: boolean;
        canStart?: boolean;
        toolCallCount: number;
    };
    expected: {
        route?: string;
        routeSource?: string;
        skillId?: string;
        executionKind?: string;
        requiresPhotoshop?: boolean;
        shouldUseTools?: boolean;
    };
    blockers: string[];
    warnings: string[];
    requiredNextChecks: string[];
    limitations: string[];
}

export interface BuildAgentIntentDecisionIntakeInput {
    lifecycle?: AgentRequestLifecycleRecord;
    acceptanceCase?: Pick<AgentAcceptanceCase, 'expectation'>;
    executionSummary?: AgentAcceptanceExecutionSummary;
    tools?: AgentAcceptanceToolEvent[];
    generatedAt?: string;
}

interface IntakeAnalysis {
    blockers: string[];
    warnings: string[];
    requiredNextChecks: string[];
}

export function buildAgentIntentDecisionIntake(
    input: BuildAgentIntentDecisionIntakeInput
): AgentIntentDecisionIntake {
    const lifecycle = input.lifecycle;
    const expected = input.acceptanceCase?.expectation || {};
    const toolCallCount = countToolCalls(input);
    const analysis = analyzeIntentDecision(input, toolCallCount);
    const status = deriveStatus(input, analysis, toolCallCount);

    return {
        version: 'agent-intent-decision-intake/v0',
        status,
        generatedAt: input.generatedAt || new Date().toISOString(),
        reviewOnly: true,
        userVisible: false,
        canClaimDesignQuality: false,
        mustNotChangeRouting: true,
        mustNotRunProvider: true,
        mustNotRunPhotoshop: true,
        observed: {
            route: lifecycle?.decision.route,
            routeSource: lifecycle?.decision.source,
            skillId: lifecycle?.decision.skillId,
            executionKind: lifecycle?.execution.kind,
            requiresPhotoshop: lifecycle?.execution.requiresPhotoshop,
            canStart: lifecycle?.execution.canStart,
            toolCallCount
        },
        expected: {
            route: expected.route,
            routeSource: expected.routeSource,
            skillId: expected.skillId,
            executionKind: expected.executionKind,
            requiresPhotoshop: expected.requiresPhotoshop,
            shouldUseTools: expected.shouldUseTools
        },
        blockers: analysis.blockers,
        warnings: analysis.warnings,
        requiredNextChecks: analysis.requiredNextChecks,
        limitations: [
            '该 intake 只消费已有 lifecycle、executionSummary 和工具事件。',
            '该 intake 不调用模型、不执行 Photoshop、不证明设计质量。',
            '该 intake 是隐藏验收记录，不进入用户可见思考区。'
        ]
    };
}

export function isAgentIntentDecisionBoundaryOk(
    intake: AgentIntentDecisionIntake | undefined
): boolean | undefined {
    if (!intake) return undefined;
    return intake.reviewOnly === true
        && intake.userVisible === false
        && intake.canClaimDesignQuality === false
        && intake.mustNotChangeRouting === true
        && intake.mustNotRunProvider === true
        && intake.mustNotRunPhotoshop === true;
}

function analyzeIntentDecision(
    input: BuildAgentIntentDecisionIntakeInput,
    toolCallCount: number
): IntakeAnalysis {
    const lifecycle = input.lifecycle;
    const expected = input.acceptanceCase?.expectation || {};
    const blockers: string[] = [];
    const warnings: string[] = [];
    const requiredNextChecks: string[] = [];

    if (!lifecycle) {
        blockers.push('缺少 agentRequestLifecycle，无法判断用户意图与路由决策。');
        requiredNextChecks.push('agent_request_lifecycle_required');
        return { blockers, warnings, requiredNextChecks };
    }

    if (expected.route && lifecycle.decision.route !== expected.route) {
        blockers.push('路由与验收期望不一致。');
        requiredNextChecks.push('routing_decision_review_required');
    }
    if (expected.routeSource && lifecycle.decision.source !== expected.routeSource) {
        blockers.push('路由来源与验收期望不一致。');
        requiredNextChecks.push('route_source_review_required');
    }
    if (expected.skillId && lifecycle.decision.skillId !== expected.skillId) {
        blockers.push('命中的 skill 与验收期望不一致。');
        requiredNextChecks.push('skill_decision_review_required');
    }
    if (expected.executionKind && lifecycle.execution.kind !== expected.executionKind) {
        blockers.push('执行类型与验收期望不一致。');
        requiredNextChecks.push('execution_kind_review_required');
    }
    if (typeof expected.requiresPhotoshop === 'boolean'
        && lifecycle.execution.requiresPhotoshop !== expected.requiresPhotoshop) {
        blockers.push('Photoshop 需求判断与验收期望不一致。');
        requiredNextChecks.push('photoshop_requirement_review_required');
    }

    if (lifecycle.execution.requiresPhotoshop && !lifecycle.execution.canStart) {
        blockers.push('执行前上下文不足，当前路由不能安全开始。');
        requiredNextChecks.push('photoshop_context_or_document_required');
    }
    if (lifecycle.blockers.length > 0) {
        blockers.push(...lifecycle.blockers);
    }

    if (expected.shouldUseTools === true && toolCallCount === 0) {
        blockers.push('期望执行工具，但没有工具调用记录。');
        requiredNextChecks.push('tool_call_record_required');
    }
    if (expected.shouldUseTools === false && toolCallCount > 0) {
        warnings.push('当前任务期望不使用工具，但实际存在工具调用记录。');
        requiredNextChecks.push('unexpected_tool_usage_review');
    }
    if (lifecycle.decision.route === 'autonomous_agent') {
        warnings.push('当前进入 autonomous_agent，需要确认上下文、预算和可验收计划，避免简单任务绕远路。');
        requiredNextChecks.push('autonomous_route_context_and_budget_review');
    }

    warnings.push(...lifecycle.warnings);
    warnings.push(...normalizeStringArray(input.executionSummary?.warnings));
    return {
        blockers: uniqueStrings(blockers),
        warnings: uniqueStrings(warnings),
        requiredNextChecks: uniqueStrings(requiredNextChecks)
    };
}

function deriveStatus(
    input: BuildAgentIntentDecisionIntakeInput,
    analysis: IntakeAnalysis,
    toolCallCount: number
): AgentIntentDecisionIntakeStatus {
    const lifecycle = input.lifecycle;
    if (!lifecycle) return 'missing_lifecycle';
    if (analysis.blockers.some((item) => item.includes('不一致'))) return 'route_mismatch';
    if (analysis.blockers.length > 0) return 'blocked_or_missing_context';

    const shouldUseTools = input.acceptanceCase?.expectation.shouldUseTools;
    if (shouldUseTools === true && toolCallCount === 0) return 'tool_usage_mismatch';
    if (shouldUseTools === false && toolCallCount > 0) return 'tool_usage_mismatch';
    if (lifecycle.decision.route === 'autonomous_agent') return 'autonomous_needs_review';
    if (lifecycle.decision.route === 'direct_response') return 'chat_only';
    if (lifecycle.execution.kind === 'deterministic_skill') return 'deterministic_skill_ready';
    return 'needs_review';
}

function countToolCalls(input: BuildAgentIntentDecisionIntakeInput): number {
    const explicitToolCount = input.tools?.length || 0;
    const summaryToolCount = Number(input.executionSummary?.toolCallCount || 0);
    return Math.max(explicitToolCount, Number.isFinite(summaryToolCount) ? summaryToolCount : 0);
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function uniqueStrings(value: string[]): string[] {
    return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}
