import {
    buildAgentExecutionLifecycleSnapshot,
    isAgentExecutionLifecycleBoundaryOk,
    type AgentExecutionLifecycleSnapshot,
    type AgentExecutionLifecycleStatus
} from './agent-execution-lifecycle';
import {
    normalizeAgentExecutionSummaryText,
    resolveAgentExecutionBusinessActivityCounts,
    type AgentExecutionBusinessActivityCounts
} from './agent-execution-activity-counts';
import type { AgentRequestLifecycleRecord } from './agent-request-lifecycle';

export type AgentProcessInspectorVersion = 'agent-process-inspector/v0';

export type AgentProcessInspectorStatus =
    | 'no_record'
    | 'running'
    | 'completed'
    | 'needs_review'
    | 'awaiting_confirmation'
    | 'failed'
    | 'cancelled';

export interface AgentProcessExecutionSummaryLike {
    status?: string;
    stopReason?: string;
    businessActionCount?: number;
    harnessActionCount?: number;
    toolCallCount?: number;
    successfulToolCalls?: number;
    failedToolCalls?: number;
    acceptanceVerified?: number;
    acceptanceFailed?: number;
    acceptanceNeedsReview?: number;
    lastToolName?: string;
    lastError?: string;
    blockers?: unknown;
    warnings?: unknown;
    summaryText?: string;
}

export interface AgentProcessInspectorMessageLike {
    id?: string;
    role?: string;
    executionSummary?: AgentProcessExecutionSummaryLike;
    agentRequestLifecycle?: AgentRequestLifecycleRecord;
}

export interface BuildAgentProcessInspectorInput {
    messages?: AgentProcessInspectorMessageLike[];
    isLoading?: boolean;
    generatedAt?: string;
}

export interface AgentProcessInspectorStatusItem {
    id: string;
    label: string;
    state: 'present' | 'missing' | 'not_needed' | 'warning' | 'blocked';
    detail?: string;
}

export interface AgentProcessInspectorViewModel {
    version: AgentProcessInspectorVersion;
    status: AgentProcessInspectorStatus;
    label: string;
    summary: string;
    generatedAt: string;
    sourceMessageId?: string;
    source: 'message_record' | 'loading_state' | 'empty_conversation';
    lifecycleSnapshot: AgentExecutionLifecycleSnapshot;
    lifecycleBoundaryOk: boolean;
    actorLabel: string;
    routeLabel: string;
    toolLabel: string;
    qa: {
        verified: number;
        failed: number;
        needsReview: number;
    };
    blockers: string[];
    warnings: string[];
    statusItems: AgentProcessInspectorStatusItem[];
    canClaimDesignQuality: false;
    canClaimProviderThinking: false;
    canRunProvider: false;
    canRunPhotoshop: false;
}

export function buildAgentProcessInspector(
    input: BuildAgentProcessInspectorInput
): AgentProcessInspectorViewModel {
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const sourceMessage = findLatestAssistantStateMessage(messages);
    const summary = sourceMessage?.executionSummary;
    const lifecycle = sourceMessage?.agentRequestLifecycle;
    const blockers = uniqueStrings([
        ...normalizeStringArray(summary?.blockers),
        ...normalizeStringArray(lifecycle?.blockers)
    ]);
    const warnings = uniqueStrings([
        ...normalizeStringArray(summary?.warnings),
        ...normalizeStringArray(lifecycle?.warnings)
    ]);
    const status = deriveInspectorStatus({
        isLoading: input.isLoading === true,
        hasMessages: messages.length > 0,
        summary
    });
    const activityCounts = resolveAgentExecutionBusinessActivityCounts(summary);
    const lifecycleSnapshot = buildAgentExecutionLifecycleSnapshot({
        lifecycle,
        status: mapInspectorStatusToLifecycleStatus(status),
        toolCallCount: activityCounts.total,
        activeToolName: summary?.lastToolName,
        blockers,
        warnings,
        generatedAt: input.generatedAt
    });
    const qa = {
        verified: normalizeCount(summary?.acceptanceVerified),
        failed: normalizeCount(summary?.acceptanceFailed),
        needsReview: normalizeCount(summary?.acceptanceNeedsReview)
    };

    return {
        version: 'agent-process-inspector/v0',
        status,
        label: getInspectorStatusLabel(status, lifecycleSnapshot),
        summary: buildSummary({ status, summary, lifecycleSnapshot, activityCounts }),
        generatedAt: lifecycleSnapshot.generatedAt,
        sourceMessageId: sourceMessage?.id,
        source: sourceMessage ? 'message_record' : input.isLoading ? 'loading_state' : 'empty_conversation',
        lifecycleSnapshot,
        lifecycleBoundaryOk: isAgentExecutionLifecycleBoundaryOk(lifecycleSnapshot) === true,
        actorLabel: lifecycleSnapshot.actor.label,
        routeLabel: buildRouteLabel(lifecycleSnapshot),
        toolLabel: buildToolLabel(summary, activityCounts),
        qa,
        blockers,
        warnings,
        statusItems: buildStatusItems({ lifecycle, summary, lifecycleSnapshot, qa, blockers, warnings }),
        canClaimDesignQuality: false,
        canClaimProviderThinking: false,
        canRunProvider: false,
        canRunPhotoshop: false
    };
}

function findLatestAssistantStateMessage(
    messages: AgentProcessInspectorMessageLike[]
): AgentProcessInspectorMessageLike | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== 'assistant') continue;
        if (message.executionSummary || message.agentRequestLifecycle) {
            return message;
        }
    }
    return undefined;
}

function deriveInspectorStatus(input: {
    isLoading: boolean;
    hasMessages: boolean;
    summary?: AgentProcessExecutionSummaryLike;
}): AgentProcessInspectorStatus {
    const summaryStatus = normalizeText(input.summary?.status).toLowerCase();
    if (summaryStatus === 'completed') return 'completed';
    if (summaryStatus === 'needs_review') return 'needs_review';
    if (summaryStatus === 'awaiting_confirmation') return 'awaiting_confirmation';
    if (summaryStatus === 'failed') return 'failed';
    if (summaryStatus === 'cancelled') return 'cancelled';
    if (input.isLoading) return 'running';
    return input.hasMessages ? 'needs_review' : 'no_record';
}

function mapInspectorStatusToLifecycleStatus(
    status: AgentProcessInspectorStatus
): AgentExecutionLifecycleStatus {
    if (status === 'completed') return 'completed';
    if (status === 'needs_review') return 'needs_review';
    if (status === 'awaiting_confirmation') return 'awaiting_confirmation';
    if (status === 'failed') return 'failed';
    if (status === 'cancelled') return 'cancelled';
    return 'running';
}

function getInspectorStatusLabel(
    status: AgentProcessInspectorStatus,
    snapshot: AgentExecutionLifecycleSnapshot
): string {
    if (status === 'no_record') return '暂无执行记录';
    if (status === 'needs_review') return '需要复核';
    if (status === 'awaiting_confirmation') return '等待确认';
    return snapshot.statusLabel;
}

function buildSummary(input: {
    status: AgentProcessInspectorStatus;
    summary?: AgentProcessExecutionSummaryLike;
    lifecycleSnapshot: AgentExecutionLifecycleSnapshot;
    activityCounts: AgentExecutionBusinessActivityCounts;
}): string {
    const summaryText = normalizeAgentExecutionSummaryText(
        input.summary?.summaryText,
        input.activityCounts
    );
    if (summaryText) return summaryText;
    if (input.status === 'no_record') return '当前对话还没有可用于判断 Agent 过程的执行记录。';
    if (input.status === 'running') return `${input.lifecycleSnapshot.statusLabel}，等待新的生命周期或工具事件。`;
    return input.lifecycleSnapshot.statusLabel;
}

function buildRouteLabel(snapshot: AgentExecutionLifecycleSnapshot): string {
    const parts = [
        normalizeText(snapshot.route.route),
        normalizeText(snapshot.route.skillId),
        normalizeText(snapshot.route.executionKind)
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : '未记录路由';
}

function buildToolLabel(
    summary: AgentProcessExecutionSummaryLike | undefined,
    activityCounts: AgentExecutionBusinessActivityCounts
): string {
    const businessActionCount = activityCounts.total;
    const harnessActionCount = normalizeCount(summary?.harnessActionCount);
    const lastToolName = normalizeText(summary?.lastToolName);
    if (businessActionCount <= 0) {
        return harnessActionCount > 0
            ? `无业务动作，内部控制 ${harnessActionCount} 次`
            : '无业务动作记录';
    }
    const suffix = lastToolName ? `，最近：${lastToolName}` : '';
    const harnessSuffix = harnessActionCount > 0 ? `，内部控制 ${harnessActionCount} 次` : '';
    if (!activityCounts.breakdownAvailable) {
        return `${businessActionCount} 次业务动作，完成明细未记录${harnessSuffix}${suffix}`;
    }
    return `${businessActionCount} 次业务动作，完成 ${activityCounts.completed}，未完成 ${activityCounts.failed}${harnessSuffix}${suffix}`;
}

function buildStatusItems(input: {
    lifecycle?: AgentRequestLifecycleRecord;
    summary?: AgentProcessExecutionSummaryLike;
    lifecycleSnapshot: AgentExecutionLifecycleSnapshot;
    qa: AgentProcessInspectorViewModel['qa'];
    blockers: string[];
    warnings: string[];
}): AgentProcessInspectorStatusItem[] {
    const hasLifecycle = Boolean(input.lifecycle);
    const hasSummary = Boolean(input.summary);
    const qaTotal = input.qa.verified + input.qa.failed + input.qa.needsReview;
    return [
        {
            id: 'request-lifecycle',
            label: '请求生命周期',
            state: hasLifecycle ? 'present' : 'missing',
            detail: hasLifecycle ? buildRouteLabel(input.lifecycleSnapshot) : '缺少 agentRequestLifecycle'
        },
        {
            id: 'execution-summary',
            label: '执行摘要',
            state: hasSummary ? 'present' : 'missing',
            detail: hasSummary ? input.lifecycleSnapshot.statusLabel : '缺少 executionSummary'
        },
        {
            id: 'tool-state',
            label: '工具状态',
            state: input.lifecycleSnapshot.toolState.toolCallCount > 0 ? 'present' : 'not_needed',
            detail: input.lifecycleSnapshot.toolState.activeToolName || `${input.lifecycleSnapshot.toolState.toolCallCount} 次`
        },
        {
            id: 'qa-state',
            label: '验收状态',
            state: qaTotal > 0 ? (input.qa.failed > 0 ? 'blocked' : 'present') : 'missing',
            detail: `通过 ${input.qa.verified}，失败 ${input.qa.failed}，待复核 ${input.qa.needsReview}`
        },
        {
            id: 'blockers',
            label: '阻断项',
            state: input.blockers.length > 0 ? 'blocked' : 'not_needed',
            detail: input.blockers[0] || '无阻断项'
        },
        {
            id: 'warnings',
            label: '风险提示',
            state: input.warnings.length > 0 ? 'warning' : 'not_needed',
            detail: input.warnings[0] || '无风险提示'
        }
    ];
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
