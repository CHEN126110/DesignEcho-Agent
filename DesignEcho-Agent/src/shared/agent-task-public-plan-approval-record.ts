import type { AgentTaskPlanningContract } from './agent-task-planning-contract';
import type {
    AgentTaskPublicPlanExecutionPlanLike,
    AgentTaskPublicPlanExecutionRequest
} from './agent-task-public-plan-execution-request';

export type AgentTaskPublicPlanApprovalRecordVersion = 'agent-task-public-plan-approval-record/v0';

export type AgentTaskPublicPlanApprovalRecordStatus =
    | 'not_requested'
    | 'blocked_no_pending_public_plan'
    | 'blocked_pending_request_not_confirmable'
    | 'approved_controlled_execution_request';

export interface AgentTaskPublicPlanApprovalRecord {
    version: AgentTaskPublicPlanApprovalRecordVersion;
    status: AgentTaskPublicPlanApprovalRecordStatus;
    requested: boolean;
    sourceMessageId?: string;
    requestId?: string;
    writesPerformed: false;
    rawPayloadRedacted: true;
    mustNotRunProvider: true;
    mustNotRunPhotoshop: true;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    userConfirmed: boolean;
    enableControlledExecutionRequest: boolean;
    allowedWriteTools: string[];
    readbackTargets: string[];
    blockers: string[];
    warnings: string[];
    agentTaskPlan?: AgentTaskPlanningContract;
    agentTaskPublicPlan?: AgentTaskPublicPlanExecutionPlanLike;
}

export interface BuildAgentTaskPublicPlanApprovalRecordInput {
    userInput: unknown;
    conversationHistory?: Array<Record<string, unknown>>;
    sourceMessageId?: unknown;
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeText(value: unknown, maxLength = 240): string {
    const text = normalizeText(value)
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]');
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringList(value: unknown, limit = 12): string[] {
    if (!Array.isArray(value)) return [];
    const output: string[] = [];
    for (const item of value) {
        const text = sanitizeText(item, 80);
        if (!text || output.includes(text)) continue;
        output.push(text);
        if (output.length >= limit) break;
    }
    return output;
}

export function isPublicPlanConfirmationInput(value: unknown): boolean {
    const text = normalizeText(value);
    if (!text) return false;
    // 含术语的严格确认句
    const strictPatterns = [
        /^(确认|同意|批准|允许|开始|继续)\s*(执行|运行)?\s*(这个|该)?\s*(公开计划|设计计划|受控执行请求)[。.!！?？\s]*$/i,
        /^(按|按照)\s*(这个|该)?\s*(公开计划|设计计划)\s*(执行|继续|开始)[。.!！?？\s]*$/i,
        /^确认执行公开计划[。.!！?？\s]*$/i
    ];
    if (strictPatterns.some((pattern) => pattern.test(text))) return true;

    // 自然语言确认：总监不会说系统术语（实测「确认计划，开始评审」被旧规则漏判，
    // 落进对话路径变成「说要做但不做」）。条件：短句 + 整句由确认成分构成 + 无否定/新指令。
    // 误判保护：没有等待确认的公开计划时，调用方仍会按 no_pending_public_plan 拦截，
    // 这里命中只代表「这是一句确认话」，不代表「允许执行」。
    if (text.length > 24) return false;
    if (/(不|别|先等|等等|暂停|取消|换|改成|另外|再加)/.test(text)) return false;
    const naturalConfirmation =
        /^(确认|同意|批准|可以|好的|好|行|嗯|没问题|ok|okay)([，,、!！。.\s]*(计划|方案|执行|运行|开始|继续|评审|分析|开干|干吧|去做|做吧|进行|没问题|吧|了))*[。.!！~\s的啊呀呐]*$/i;
    return naturalConfirmation.test(text);
}

function extractObject(source: Record<string, unknown>, field: string): Record<string, unknown> | undefined {
    const direct = source[field];
    if (isPlainObject(direct)) return direct;
    const metadata = source.metadata;
    if (isPlainObject(metadata) && isPlainObject(metadata[field])) return metadata[field] as Record<string, unknown>;
    const metadataData = isPlainObject(metadata) ? metadata.data : undefined;
    if (isPlainObject(metadataData) && isPlainObject(metadataData[field])) return metadataData[field] as Record<string, unknown>;
    const data = source.data;
    if (isPlainObject(data) && isPlainObject(data[field])) return data[field] as Record<string, unknown>;
    return undefined;
}

function findLatestPendingPublicPlanMessage(history: Array<Record<string, unknown>>, sourceMessageId?: string): {
    message: Record<string, unknown>;
    request: AgentTaskPublicPlanExecutionRequest;
    agentTaskPlan?: AgentTaskPlanningContract;
} | null {
    const sourceId = normalizeText(sourceMessageId);
    if (sourceId) {
        const sourceMessage = history.find((message) => normalizeText(message?.id) === sourceId);
        if (!sourceMessage || sourceMessage.role !== 'assistant') return null;
        const sourceRequest = extractObject(sourceMessage, 'agentTaskPublicPlanExecutionRequest');
        if (sourceRequest?.version !== 'agent-task-public-plan-execution-request/v0') return null;
        if (sourceRequest.status !== 'blocked_pending_user_confirmation') return null;
        return {
            message: sourceMessage,
            request: sourceRequest as unknown as AgentTaskPublicPlanExecutionRequest,
            agentTaskPlan: extractObject(sourceMessage, 'agentTaskPlan') as unknown as AgentTaskPlanningContract | undefined
        };
    }

    for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        if (message?.role !== 'assistant') continue;
        const request = extractObject(message, 'agentTaskPublicPlanExecutionRequest');
        if (request?.version !== 'agent-task-public-plan-execution-request/v0') continue;
        if (request.status !== 'blocked_pending_user_confirmation') continue;
        return {
            message,
            request: request as unknown as AgentTaskPublicPlanExecutionRequest,
            agentTaskPlan: extractObject(message, 'agentTaskPlan') as unknown as AgentTaskPlanningContract | undefined
        };
    }
    return null;
}

function buildRecord(
    status: AgentTaskPublicPlanApprovalRecordStatus,
    input: {
        requested: boolean;
        sourceMessageId?: string;
        requestId?: string;
        userConfirmed?: boolean;
        enableControlledExecutionRequest?: boolean;
        allowedWriteTools?: string[];
        readbackTargets?: string[];
        blockers?: string[];
        warnings?: string[];
        agentTaskPlan?: AgentTaskPlanningContract;
        agentTaskPublicPlan?: AgentTaskPublicPlanExecutionPlanLike;
    }
): AgentTaskPublicPlanApprovalRecord {
    return {
        version: 'agent-task-public-plan-approval-record/v0',
        status,
        requested: input.requested,
        sourceMessageId: input.sourceMessageId,
        requestId: input.requestId,
        writesPerformed: false,
        rawPayloadRedacted: true,
        mustNotRunProvider: true,
        mustNotRunPhotoshop: true,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        userConfirmed: input.userConfirmed === true,
        enableControlledExecutionRequest: input.enableControlledExecutionRequest === true,
        allowedWriteTools: input.allowedWriteTools || [],
        readbackTargets: input.readbackTargets || [],
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        agentTaskPlan: input.agentTaskPlan,
        agentTaskPublicPlan: input.agentTaskPublicPlan
    };
}

export function buildAgentTaskPublicPlanApprovalRecord(
    input: BuildAgentTaskPublicPlanApprovalRecordInput
): AgentTaskPublicPlanApprovalRecord {
    const requested = isPublicPlanConfirmationInput(input.userInput);
    if (!requested) {
        return buildRecord('not_requested', {
            requested: false
        });
    }

    const history = Array.isArray(input.conversationHistory) ? input.conversationHistory : [];
    const pending = findLatestPendingPublicPlanMessage(history, normalizeText(input.sourceMessageId));
    if (!pending) {
        // 没有等待确认的公开计划时，「好的」「确认」这类话只是普通对话，
        // 按 not_requested 放行给正常链路，不要拿「没找到公开计划」打断用户。
        return buildRecord('not_requested', {
            requested: false
        });
    }

    const proposedWriteTools = normalizeStringList(pending.request.proposedWriteTools);
    const allowedWriteTools = normalizeStringList(pending.request.allowedWriteTools);
    const approvedWriteTools = proposedWriteTools.filter((toolName) => allowedWriteTools.includes(toolName));
    const readbackTargets = normalizeStringList(pending.request.readbackTargets);
    const blockedWriteTools = proposedWriteTools.filter((toolName) => !approvedWriteTools.includes(toolName));

    // 只读计划（评审/分析）：没有写工具诉求但有读回目标——确认后以空写白名单
    // 进入受控执行（运行期写工具全部被拦），不能被「缺少写工具白名单」卡死。
    const isReadOnlyPlanConfirmation = proposedWriteTools.length === 0 && readbackTargets.length > 0;

    // blockedWriteTools（模型列的别名/未授权工具）不阻断确认：批准只授权 approvedWriteTools，
    // 别名工具运行时由执行点契约把关。只要有授权写工具（或是只读计划）+ 读回目标即可确认。
    if ((approvedWriteTools.length === 0 && !isReadOnlyPlanConfirmation)
        || readbackTargets.length === 0) {
        return buildRecord('blocked_pending_request_not_confirmable', {
            requested: true,
            sourceMessageId: normalizeText(pending.message.id),
            requestId: pending.request.requestId,
            allowedWriteTools: approvedWriteTools,
            readbackTargets,
            blockers: [
                approvedWriteTools.length === 0 ? '计划没有可确认的写工具白名单。' : '',
                readbackTargets.length === 0 ? '计划没有执行后的读回目标。' : '',
                blockedWriteTools.length > 0 ? `计划包含未获批准的写工具：${blockedWriteTools.join(', ')}` : ''
            ].filter(Boolean)
        });
    }

    const firstOperationSummary = pending.request.operationRequests
        .map((item) => sanitizeText(item.paramsSummary))
        .find(Boolean);
    const executionPlanSummary = sanitizeText(pending.request.executionPlanSummary)
        || firstOperationSummary
        || '用户已确开计划，准备创建受控执行请求。';
    const approvedPublicPlan: AgentTaskPublicPlanExecutionPlanLike = {
        status: 'ready',
        canExecuteTools: false,
        message: sanitizeText(pending.request.publicPlanSummary || pending.message.content),
        proposedWriteTools: approvedWriteTools,
        writeToolAllowlist: approvedWriteTools,
        readbackTargets,
        executionPlanSummary
    };

    return buildRecord('approved_controlled_execution_request', {
        requested: true,
        sourceMessageId: normalizeText(pending.message.id),
        requestId: pending.request.requestId || normalizeText(pending.message.id) || 'agent-task-public-plan-execution-request',
        userConfirmed: true,
        enableControlledExecutionRequest: true,
        allowedWriteTools: approvedWriteTools,
        readbackTargets,
        agentTaskPlan: pending.agentTaskPlan,
        agentTaskPublicPlan: approvedPublicPlan,
        warnings: ['确认记录只创建受控执行请求；真实 Photoshop 写入仍必须由后续受控 runner 执行。']
    });
}
