import { buildConversationalUnavailableMessage } from './conversational-unavailable-message';

export type AgentUserVisibleStateVersion = 'agent-user-visible-state/v0';

export type AgentUserVisibleStateCategory =
    | 'conversation'
    | 'clarification'
    | 'read_only'
    | 'tool_execution'
    | 'planning'
    | 'controlled_execution'
    | 'blocked';

export type AgentUserVisibleToolUse =
    | 'no_tools'
    | 'read_only'
    | 'direct_tools'
    | 'controlled_write_after_gate'
    | 'blocked';

export interface BuildAgentUserVisibleStateInput {
    route?: string;
    planningStatus?: string;
    requestKind?: string;
    toolDecisionNextAction?: string;
}

export interface AgentUserVisibleState {
    version: AgentUserVisibleStateVersion;
    category: AgentUserVisibleStateCategory;
    title: string;
    summary: string;
    nextStep: string;
    toolUse: AgentUserVisibleToolUse;
    canStartTools: boolean;
    userActionRequired: boolean;
}

const PUBLIC_STATUS_MESSAGES: Array<[RegExp, string]> = [
    [/^needs_model_design_decision$/i, '需要先确认画面重点、素材取舍和结果检查方式；本轮不会直接改动画面。'],
    [/^needs_visual_observation$/i, '需要先确认项目视觉素材和设计方向，再继续处理。'],
    [/^blocked_missing_photoshop_connection$/i, '需要先连接 Photoshop，并确认 UXP 插件面板已打开；恢复连接后再继续执行。'],
    [/^photoshop_not_connected$/i, '需要先连接 Photoshop，并确认 UXP 插件面板已打开；恢复连接后再继续执行。'],
    [/^photoshop_bridge_not_ready$/i, '需要先连接 Photoshop，并确认 UXP 插件面板已打开；恢复连接后再继续执行。'],
    [/^blocked_missing_document$/i, '需要先打开要处理的 Photoshop 文档；本轮不会改动画面。'],
    [/^photoshop_document_required$/i, '需要先打开要处理的 Photoshop 文档；本轮不会改动画面。'],
    [/^blocked_missing_sku_source_file$/i, '当前项目缺少可用的 SKU PSD/PSB 素材文件；请先补齐项目 SKU 源文件后再执行。'],
    [/^sku document not found$/i, '当前项目缺少可用的 SKU PSD/PSB 素材文件；请先补齐项目 SKU 源文件后再执行。'],
    [/^conversational reply unavailable$/i, buildConversationalUnavailableMessage({ audience: 'general', kind: 'unknown' })],
    [/^skill disabled$/i, '这个操作暂时还不能直接完成；本轮不会改动画面。'],
    [/^skill executor not found$/i, '这个操作暂时还不能直接完成；本轮不会改动画面。'],
    [/^tool_call_failed(?::|$)/i, '处理没有完成，当前条件还不够完整；本轮不会改动画面。'],
    [/^blocked_[a-z0-9_:-]+$/i, '当前还缺少关键信息；本轮不会改动画面。']
];

const NEXT_ACTION_PUBLIC_TEXT: Record<string, string> = {
    execute_tools: '直接处理并复核结果。',
    answer_without_tools: '本轮只说明判断，不改动画面。',
    model_replan_without_tools: '先把判断说明清楚。',
    model_replan_with_allowed_tools: '换一种更稳的处理方式。',
    respect_system_boundary: '等待连接、文档或上下文恢复后再继续。'
};

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function pickStatus(input: BuildAgentUserVisibleStateInput): string {
    return normalizeText(input.planningStatus || input.route || input.requestKind || input.toolDecisionNextAction);
}

function isBlockingStatus(status: string): boolean {
    return (status !== 'blocked_needs_clarification' && /^blocked_[a-z0-9_:-]+$/i.test(status))
        || /^tool_call_failed(?::|$)/i.test(status)
        || /^needs_model_design_decision$/i.test(status)
        || /^needs_visual_observation$/i.test(status)
        || /^photoshop_not_connected$/i.test(status)
        || /^photoshop_bridge_not_ready$/i.test(status)
        || /^photoshop_document_required$/i.test(status)
        || /^sku document not found$/i.test(status)
        || /^skill disabled$/i.test(status)
        || /^skill executor not found$/i.test(status);
}

function state(
    category: AgentUserVisibleStateCategory,
    title: string,
    summary: string,
    nextStep: string,
    toolUse: AgentUserVisibleToolUse,
    options: {
        canStartTools?: boolean;
        userActionRequired?: boolean;
    } = {}
): AgentUserVisibleState {
    return {
        version: 'agent-user-visible-state/v0',
        category,
        title,
        summary,
        nextStep,
        toolUse,
        canStartTools: options.canStartTools === true,
        userActionRequired: options.userActionRequired === true
    };
}

export function getInternalAgentStatusPublicMessage(value: unknown): string | undefined {
    const text = normalizeText(value);
    if (!text) return undefined;
    if (/^(?:direct_response|ready_direct_response|clarification_needed|blocked_needs_clarification)$/i.test(text)) {
        return undefined;
    }
    for (const [pattern, message] of PUBLIC_STATUS_MESSAGES) {
        if (pattern.test(text)) return message;
    }
    if (/(?:^|[:\s])blocked_[a-z0-9_:-]+\b/i.test(text)) {
        return '当前还缺少关键信息；本轮不会改动画面。';
    }
    if (/(?:^|[:\s])tool_call_failed\b/i.test(text)) {
        return '处理没有完成，当前条件还不够完整；本轮不会改动画面。';
    }
    return undefined;
}

export function getAgentToolDecisionNextActionPublicText(value: unknown): string {
    const key = normalizeText(value);
    return NEXT_ACTION_PUBLIC_TEXT[key] || '根据当前条件重新规划下一步。';
}

export function buildAgentUserVisibleState(
    input: BuildAgentUserVisibleStateInput
): AgentUserVisibleState {
    const status = pickStatus(input);
    const requestKind = normalizeText(input.requestKind);
    const nextAction = normalizeText(input.toolDecisionNextAction);

    if (nextAction && nextAction !== 'execute_tools') {
        return state(
            nextAction === 'respect_system_boundary' ? 'blocked' : 'planning',
            nextAction === 'respect_system_boundary' ? '还缺少条件' : '调整处理方式',
            getAgentToolDecisionNextActionPublicText(nextAction),
            getAgentToolDecisionNextActionPublicText(nextAction),
            nextAction === 'respect_system_boundary' ? 'blocked' : 'no_tools',
            { canStartTools: false, userActionRequired: nextAction === 'respect_system_boundary' }
        );
    }

    if (isBlockingStatus(status)) {
        return state(
            'blocked',
            '还缺少条件',
            getInternalAgentStatusPublicMessage(status) || '当前还缺少关键信息；本轮不会改动画面。',
            '先补齐素材、文档或目标信息后再继续。',
            'blocked',
            { canStartTools: false, userActionRequired: true }
        );
    }

    if (status === 'ready_direct_response' || status === 'direct_response' || requestKind === 'chat_only' || requestKind === 'plan_only') {
        return state(
            'conversation',
            '对话',
            '这次只回答问题，不改动画面。',
            '需要处理画面时再检查素材、文档和版面空间。',
            'no_tools',
            { canStartTools: false, userActionRequired: false }
        );
    }

    if (status === 'blocked_needs_clarification' || status === 'clarification_needed' || requestKind === 'clarify') {
        return state(
            'clarification',
            '需要补充信息',
            '当前信息不足以确定下一步。',
            '补充关键信息后再继续判断。',
            'no_tools',
            { canStartTools: false, userActionRequired: true }
        );
    }

    if (status === 'ready_read_only_plan' || requestKind === 'read_only_inspect') {
        return state(
            'read_only',
            '读取项目信息',
            '只读取项目、文档和图层信息，不改变当前画面。',
            '读取完成后给出判断。',
            'read_only',
            { canStartTools: true, userActionRequired: false }
        );
    }

    if (status === 'ready_for_tool_execution') {
        return state(
            'tool_execution',
            '准备处理画面',
            '已识别为明确的 Photoshop 处理任务，按真实画面结果推进。',
            '完成后复核文档、图层或导出结果。',
            'direct_tools',
            { canStartTools: true, userActionRequired: false }
        );
    }

    if (status === 'ready_for_model_planning') {
        return state(
            'planning',
            '整理设计方向',
            '确认画面重点、版式、色彩和效果检查方式。',
            '确认画面方向和验收方式后再继续。',
            'no_tools',
            { canStartTools: false, userActionRequired: false }
        );
    }

    if (status === 'ready_for_controlled_execution_plan' || requestKind === 'execute_skill') {
        return state(
            'controlled_execution',
            '检查素材和文档',
            '确认素材、设计文档和连接状态后再处理。',
            '确认无误后继续当前设计任务。',
            'controlled_write_after_gate',
            { canStartTools: true, userActionRequired: false }
        );
    }

    if (requestKind === 'autonomous_execution') {
        return state(
            'planning',
            '整理设计方向',
            '确认画面重点、版式、色彩和效果检查方式。',
            '确认画面方向和验收方式后再继续。',
            'no_tools',
            { canStartTools: false, userActionRequired: false }
        );
    }

    return state(
        'blocked',
        '还缺少条件',
        getInternalAgentStatusPublicMessage(status) || '当前还缺少关键信息；本轮不会改动画面。',
        '先补齐素材、文档或目标信息后再继续。',
        'blocked',
        { canStartTools: false, userActionRequired: true }
    );
}
