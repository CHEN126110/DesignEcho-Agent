import type { AgentRequestLifecycleRecord } from './agent-request-lifecycle';

export type AgentResumableTaskContractVersion = 'agent-resumable-task-contract/v0';

export type AgentResumableTaskStatus =
    | 'not_requested'
    | 'blocked_no_history'
    | 'ready_for_model_contextual_reply'
    | 'blocked_last_turn_not_executable'
    | 'blocked_last_turn_completed'
    | 'blocked_last_turn_failed'
    | 'blocked_missing_execution_context'
    | 'candidate_for_execution_resume';

export interface AgentResumableTaskMessageLike {
    id?: unknown;
    role?: string;
    content?: unknown;
    metadata?: unknown;
    data?: unknown;
    agentRequestLifecycle?: unknown;
    executionSummary?: unknown;
    interactiveCards?: unknown;
    interactiveCardSubmissions?: unknown;
    pendingInteractiveContinuation?: unknown;
    success?: unknown;
}

export interface BuildAgentResumableTaskContractInput {
    userInput: unknown;
    conversationHistory?: AgentResumableTaskMessageLike[];
}

export interface AgentResumableTaskContract {
    version: AgentResumableTaskContractVersion;
    status: AgentResumableTaskStatus;
    requested: boolean;
    canResumeExecution: boolean;
    requiresModelReconfirmation: boolean;
    requiresFreshContext: boolean;
    previousUserInput?: string;
    previousRoute?: string;
    previousSkillId?: string;
    blockers: string[];
    warnings: string[];
    contextOnly: true;
    mustNotRunProvider: true;
    mustNotRunPhotoshop: true;
    mustNotClaimTaskCompletion: true;
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isContinuationRequest(value: unknown): boolean {
    const text = normalizeText(value).toLowerCase();
    return /^(好的|好|ok|收到|可以)?\s*(继续|接着|继续下一项|继续下一步|继续推进|按照计划继续|继续剩余|接着做|往下做|下一项|下一步)[\s!！?？,，.。~～]*$/i.test(text);
}

function extractObjectField(source: unknown, field: string): unknown {
    if (!isPlainObject(source)) return undefined;
    return source[field];
}

function extractLifecycle(message: AgentResumableTaskMessageLike): AgentRequestLifecycleRecord | undefined {
    const candidates = [
        message.agentRequestLifecycle,
        extractObjectField(message.metadata, 'agentRequestLifecycle'),
        extractObjectField(message.data, 'agentRequestLifecycle'),
        extractObjectField(extractObjectField(message.metadata, 'data'), 'agentRequestLifecycle')
    ];

    for (const candidate of candidates) {
        if (!isPlainObject(candidate)) continue;
        if (candidate.version === 'agent-request-lifecycle/v0' && isPlainObject(candidate.decision)) {
            return candidate as unknown as AgentRequestLifecycleRecord;
        }
    }
    return undefined;
}

function extractExecutionSummary(message: AgentResumableTaskMessageLike): Record<string, unknown> | undefined {
    const candidates = [
        message.executionSummary,
        extractObjectField(message.metadata, 'executionSummary'),
        extractObjectField(message.data, 'executionSummary'),
        extractObjectField(extractObjectField(message.metadata, 'data'), 'executionSummary')
    ];
    return candidates.find(isPlainObject) as Record<string, unknown> | undefined;
}

function findLatestAssistantMessage(history: AgentResumableTaskMessageLike[]): AgentResumableTaskMessageLike | undefined {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const item = history[index];
        if (item?.role === 'assistant') return item;
    }
    return undefined;
}

function findPreviousUserInput(history: AgentResumableTaskMessageLike[]): string | undefined {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const item = history[index];
        if (item?.role !== 'user') continue;
        const content = normalizeText(item.content);
        if (content && !isContinuationRequest(content)) return content;
    }
    return undefined;
}

function buildContract(
    status: AgentResumableTaskStatus,
    input: {
        requested: boolean;
        canResumeExecution?: boolean;
        previousUserInput?: string;
        previousRoute?: string;
        previousSkillId?: string;
        blockers?: string[];
        warnings?: string[];
        requiresFreshContext?: boolean;
    }
): AgentResumableTaskContract {
    return {
        version: 'agent-resumable-task-contract/v0',
        status,
        requested: input.requested,
        canResumeExecution: input.canResumeExecution === true,
        requiresModelReconfirmation: true,
        requiresFreshContext: input.requiresFreshContext !== false,
        previousUserInput: input.previousUserInput,
        previousRoute: input.previousRoute,
        previousSkillId: input.previousSkillId,
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        contextOnly: true,
        mustNotRunProvider: true,
        mustNotRunPhotoshop: true,
        mustNotClaimTaskCompletion: true
    };
}

export function buildAgentResumableTaskContract(
    input: BuildAgentResumableTaskContractInput
): AgentResumableTaskContract {
    const requested = isContinuationRequest(input.userInput);
    if (!requested) {
        return buildContract('not_requested', {
            requested: false,
            requiresFreshContext: false
        });
    }

    const history = Array.isArray(input.conversationHistory) ? input.conversationHistory : [];
    if (history.length === 0) {
        return buildContract('blocked_no_history', {
            requested: true,
            blockers: ['没有上一轮对话历史，不能只凭“继续”恢复执行。']
        });
    }

    const previousUserInput = findPreviousUserInput(history);
    const latestAssistant = findLatestAssistantMessage(history);
    if (!latestAssistant) {
        return buildContract('ready_for_model_contextual_reply', {
            requested: true,
            previousUserInput,
            warnings: ['只有用户历史，没有助手执行记录；只能交给模型做上下文解释，不能自动恢复执行。']
        });
    }

    const lifecycle = extractLifecycle(latestAssistant);
    if (!lifecycle) {
        return buildContract('ready_for_model_contextual_reply', {
            requested: true,
            previousUserInput,
            warnings: ['上一轮助手消息没有结构化生命周期记录；不能自动恢复工具执行。']
        });
    }

    const previousRoute = lifecycle.decision.route;
    const previousSkillId = lifecycle.decision.skillId;
    const base = {
        requested: true,
        previousUserInput: lifecycle.request.rawText || previousUserInput,
        previousRoute,
        previousSkillId
    };

    if (!lifecycle.execution.requiresPhotoshop || previousRoute === 'direct_response') {
        return buildContract('blocked_last_turn_not_executable', {
            ...base,
            blockers: ['上一轮不是可恢复的 Photoshop 执行任务。'],
            requiresFreshContext: false
        });
    }

    const summary = extractExecutionSummary(latestAssistant);
    const summaryStatus = normalizeText(summary?.status || summary?.executionStatus || summary?.stopReason).toLowerCase();
    if (summaryStatus.includes('completed') || summaryStatus.includes('done') || summaryStatus.includes('success')) {
        return buildContract('blocked_last_turn_completed', {
            ...base,
            blockers: ['上一轮执行已完成；再次继续需要用户提出新的明确修改目标。'],
            requiresFreshContext: false
        });
    }
    if (summaryStatus.includes('failed') || summaryStatus.includes('error') || latestAssistant.success === false) {
        return buildContract('blocked_last_turn_failed', {
            ...base,
            blockers: ['上一轮执行失败；继续前需要先根据失败原因制定恢复动作。']
        });
    }

    if (!lifecycle.execution.canStart || lifecycle.blockers.length > 0) {
        return buildContract('blocked_missing_execution_context', {
            ...base,
            blockers: [
                ...lifecycle.blockers,
                '上一轮执行上下文不足，继续前需要重新读取当前 Photoshop 和项目状态。'
            ]
        });
    }

    return buildContract('candidate_for_execution_resume', {
        ...base,
        canResumeExecution: true,
        warnings: [
            '这是可恢复候选，不会自动执行；仍需要模型重新确认当前上下文、目标和安全边界。'
        ]
    });
}
