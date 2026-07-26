import type { AgentTaskPlanningContract } from './agent-task-planning-contract';
import { sanitizeAgentResumePlanningValue } from './agent-resume-planning';
import {
    extractUserExplicitDocumentOverrides,
    inferDesignDocumentRoleFromTaskText,
    normalizeCreateDocumentParamsForDesignRole,
    normalizeLayoutParamsForDesignRole,
    type DesignDocumentRole
} from './design-document-role';
import type { DesignDimensionSpec } from './design-dimension-spec';

export type AgentTaskPublicPlanExecutionRequestVersion = 'agent-task-public-plan-execution-request/v0';

export type AgentTaskPublicPlanExecutionRequestStatus =
    | 'not_applicable'
    | 'blocked_public_plan_not_ready'
    | 'blocked_missing_write_tool_allowlist'
    | 'blocked_write_tool_not_allowed'
    | 'blocked_missing_readback_targets'
    | 'blocked_pending_user_confirmation'
    | 'blocked_execution_request_disabled'
    | 'ready_for_controlled_execution_request';

// 批准后允许的写工具白名单：覆盖从零设计执行的核心原子工具——
// 建文档、铺背景形状、放素材、写文案、分组、排版调整。缺 createDocument 等会让
// 设计执行计划的写工具被拒（blocked_write_tool_not_allowed），批准链断裂落回对话
// （实测 C-1188 主图：计划第一步 createDocument 不在白名单 → 计划无法确认）。
export const DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST = [
    'createDocument',
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'createRectangle',
    'createEllipse',
    'createGroup',
    'groupLayers',
    'renderLayout',
    'placeImage',
    'replaceLayerContent',
    'moveLayer',
    'reorderLayer',
    'moveLayerToGroup',
    'transformLayer',
    'quickScale',
    'alignLayers',
    'distributeLayers',
    'setLayerOpacity',
    'setBlendMode',
    'addDropShadow',
    'addStroke',
    'duplicateLayer',
    'renameLayer',
    'saveDocument'
] as const;

const AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALIASES = {
    createLayerGroup: 'createGroup',
    createGroupLayer: 'createGroup',
    createRectangleLayer: 'createRectangle',
    createRectLayer: 'createRectangle',
    createText: 'createTextLayer',
    addTextLayer: 'createTextLayer'
} as const;

export interface AgentTaskPublicPlanExecutionPlanLike {
    status?: string;
    canExecuteTools?: boolean;
    message?: string;
    proposedWriteTools?: string[];
    writeToolAllowlist?: string[];
    readbackTargets?: string[];
    executionPlanSummary?: string;
}

export interface AgentTaskPublicPlanControlledOperationRequest {
    operationId: string;
    toolName: string;
    params?: unknown;
    paramsSummary?: string;
    readbackTargets: string[];
}

export interface AgentTaskPublicPlanExecutionRequest {
    version: AgentTaskPublicPlanExecutionRequestVersion;
    status: AgentTaskPublicPlanExecutionRequestStatus;
    requestId?: string;
    taskPlanStatus?: AgentTaskPlanningContract['status'];
    publicPlanStatus?: string;
    writesPerformed: false;
    rawPayloadRedacted: true;
    shouldRunPhotoshop: false;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requiresExplicitUserConfirmation: true;
    requiresWriteToolAllowlist: true;
    requiresReadbackTargets: true;
    requiresControlledRunner: true;
    requiresReadbackAfterEachWrite: true;
    userConfirmed: boolean;
    canStartControlledRunner: boolean;
    proposedWriteTools: string[];
    allowedWriteTools: string[];
    approvedWriteTools: string[];
    blockedWriteTools: string[];
    readbackTargets: string[];
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[];
    publicPlanSummary?: string;
    executionPlanSummary?: string;
    blockers: string[];
    warnings: string[];
}

export interface BuildAgentTaskPublicPlanExecutionRequestInput {
    agentTaskPlan?: AgentTaskPlanningContract;
    publicPlan?: AgentTaskPublicPlanExecutionPlanLike;
    runtimeAllowedWriteTools?: string[];
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
    userConfirmed?: boolean;
    enableControlledExecutionRequest?: boolean;
    requestId?: string;
    designDimensionSpec?: Partial<DesignDimensionSpec>;
}

function sanitizeText(value: unknown, maxLength = 240): string {
    const text = String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function isUnsafeRuntimeParamKey(key: string): boolean {
    const normalized = key.toLowerCase();
    return normalized.includes('path')
        || normalized.includes('base64')
        || normalized.includes('imagedata')
        || normalized.includes('rawimage')
        || normalized.includes('rawpayload')
        || normalized.includes('binary')
        || normalized.includes('buffer');
}

function hasUnsafeRuntimeParamValue(value: unknown, depth = 0): boolean {
    if (value === undefined || value === null) return false;
    if (depth > 6) return true;
    if (typeof value === 'string') {
        return /(data:image|base64,|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/i.test(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') return false;
    if (Array.isArray(value)) {
        return value.some((item) => hasUnsafeRuntimeParamValue(item, depth + 1));
    }
    if (typeof value !== 'object') return false;

    return Object.entries(value as Record<string, unknown>).some(([key, nestedValue]) => (
        isUnsafeRuntimeParamKey(key) || hasUnsafeRuntimeParamValue(nestedValue, depth + 1)
    ));
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

function addUniqueWarning(output: string[], warning: string): void {
    if (warning && !output.includes(warning)) output.push(warning);
}

function buildToolAliasWarning(from: string, to: string): string {
    return `已将模型输出的 Photoshop 写工具别名 ${from} 归一化为真实运行时工具 ${to}。`;
}

export function normalizeAgentTaskPublicPlanWriteToolName(value: unknown): string {
    const text = sanitizeText(value, 80);
    if (!text) return '';
    return AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALIASES[
        text as keyof typeof AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALIASES
    ] || text;
}

function normalizeWriteToolList(value: unknown, limit = 12): { values: string[]; warnings: string[] } {
    if (!Array.isArray(value)) return { values: [], warnings: [] };
    const values: string[] = [];
    const warnings: string[] = [];
    for (const item of value) {
        const original = sanitizeText(item, 80);
        if (!original) continue;
        const normalized = normalizeAgentTaskPublicPlanWriteToolName(original);
        if (!normalized || values.includes(normalized)) continue;
        values.push(normalized);
        if (normalized !== original) {
            addUniqueWarning(warnings, buildToolAliasWarning(original, normalized));
        }
        if (values.length >= limit) break;
    }
    return { values, warnings };
}

function collectRuntimeOperationToolAliasWarnings(
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[]
): string[] {
    if (!Array.isArray(runtimeOperationRequests)) return [];
    const warnings: string[] = [];
    for (const operation of runtimeOperationRequests) {
        if (!operation || typeof operation !== 'object') continue;
        const original = sanitizeText(operation.toolName, 80);
        const normalized = normalizeAgentTaskPublicPlanWriteToolName(original);
        if (original && normalized && normalized !== original) {
            addUniqueWarning(warnings, buildToolAliasWarning(original, normalized));
        }
    }
    return warnings;
}

function normalizeOperationParamsForWriteTool(input: {
    toolName: string;
    params: unknown;
}): unknown {
    if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) return input.params;
    const params = { ...(input.params as Record<string, unknown>) };
    if (
        input.toolName === 'createGroup'
        && typeof params.name === 'string'
        && String(params.name).trim()
        && !String(params.groupName || '').trim()
    ) {
        params.groupName = params.name;
    }
    if (
        input.toolName === 'createRectangle'
        && typeof params.color === 'string'
        && String(params.color).trim()
        && !String(params.fillColorHex || '').trim()
    ) {
        params.fillColorHex = params.color;
    }
    return params;
}

function collectRuntimeOperationReadbackTargets(
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[]
): string[] {
    if (!Array.isArray(runtimeOperationRequests)) return [];
    const output: string[] = [];
    for (const operation of runtimeOperationRequests) {
        const targets = normalizeStringList(operation?.readbackTargets);
        for (const target of targets) {
            if (!output.includes(target)) output.push(target);
        }
    }
    return output;
}

function resolveReadbackTargets(input: {
    publicPlan?: AgentTaskPublicPlanExecutionPlanLike;
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
}): { values: string[]; warnings: string[] } {
    const explicitTargets = normalizeStringList(input.publicPlan?.readbackTargets);
    if (explicitTargets.length > 0) return { values: explicitTargets, warnings: [] };

    const operationTargets = collectRuntimeOperationReadbackTargets(input.runtimeOperationRequests);
    if (operationTargets.length > 0) {
        return {
            values: operationTargets,
            warnings: [`公开计划缺少顶层读回目标，已从 operationRequests 合并读回目标：${operationTargets.join('、')}。`]
        };
    }

    return { values: [], warnings: [] };
}

function mergeWarnings(...warningLists: Array<string[] | undefined>): string[] {
    const output: string[] = [];
    for (const warnings of warningLists) {
        for (const warning of warnings || []) {
            addUniqueWarning(output, warning);
        }
    }
    return output;
}

function resolveProposedWriteTools(publicPlan?: AgentTaskPublicPlanExecutionPlanLike): string[] {
    return normalizeWriteToolList(
        publicPlan?.proposedWriteTools && publicPlan.proposedWriteTools.length > 0
            ? publicPlan.proposedWriteTools
            : publicPlan?.writeToolAllowlist
    ).values;
}

function hasExplicitEmptyWriteToolPlan(publicPlan?: AgentTaskPublicPlanExecutionPlanLike): boolean {
    if (!publicPlan) return false;
    const hasExplicitWriteToolField =
        Array.isArray(publicPlan.proposedWriteTools)
        || Array.isArray(publicPlan.writeToolAllowlist);
    return hasExplicitWriteToolField && resolveProposedWriteTools(publicPlan).length === 0;
}

function buildOperationRequests(input: {
    agentTaskPlan?: AgentTaskPlanningContract;
    designDimensionSpec?: Partial<DesignDimensionSpec>;
    proposedWriteTools: string[];
    readbackTargets: string[];
    executionPlanSummary?: string;
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
}): AgentTaskPublicPlanControlledOperationRequest[] {
    const runtimeOperations = normalizeRuntimeOperationRequests({
        agentTaskPlan: input.agentTaskPlan,
        designDimensionSpec: input.designDimensionSpec,
        proposedWriteTools: input.proposedWriteTools,
        readbackTargets: input.readbackTargets,
        runtimeOperationRequests: input.runtimeOperationRequests
    });
    if (runtimeOperations.length > 0) return runtimeOperations;

    return input.proposedWriteTools.map((toolName, index) => ({
        operationId: `public-plan-op-${index + 1}`,
        toolName,
        paramsSummary: input.executionPlanSummary
            ? sanitizeText(input.executionPlanSummary)
            : undefined,
        readbackTargets: [...input.readbackTargets]
    }));
}

function normalizeRuntimeOperationRequests(input: {
    agentTaskPlan?: AgentTaskPlanningContract;
    designDimensionSpec?: Partial<DesignDimensionSpec>;
    proposedWriteTools: string[];
    readbackTargets: string[];
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
}): AgentTaskPublicPlanControlledOperationRequest[] {
    if (!Array.isArray(input.runtimeOperationRequests)) return [];

    const allowedToolSet = new Set(input.proposedWriteTools);
    const output: AgentTaskPublicPlanControlledOperationRequest[] = [];
    for (const [index, operation] of input.runtimeOperationRequests.entries()) {
        if (!operation || typeof operation !== 'object') continue;
        const toolName = normalizeAgentTaskPublicPlanWriteToolName(operation.toolName);
        if (!toolName || !allowedToolSet.has(toolName)) continue;

        const readbackTargets = normalizeStringList(operation.readbackTargets);
        if (operation.params === undefined || operation.params === null) continue;
        if (hasUnsafeRuntimeParamValue(operation.params)) continue;
        const normalizedParams = normalizeOperationParamsForWriteTool({
            toolName,
            params: sanitizeAgentResumePlanningValue(operation.params)
        });
        const params = normalizeOperationParamsForDesignRole({
            toolName,
            params: normalizedParams,
            agentTaskPlan: input.agentTaskPlan,
            designDimensionSpec: input.designDimensionSpec
        });
        if (params === undefined || params === null) continue;

        output.push({
            operationId: sanitizeText(operation.operationId, 80) || `public-plan-op-${index + 1}`,
            toolName,
            params,
            paramsSummary: sanitizeText(operation.paramsSummary),
            readbackTargets: readbackTargets.length > 0 ? readbackTargets : [...input.readbackTargets]
        });
    }
    return output;
}

function inferDesignDocumentRoleFromTaskPlan(agentTaskPlan?: AgentTaskPlanningContract): DesignDocumentRole {
    const goalRole = inferDesignDocumentRoleFromTaskText(agentTaskPlan?.designBrief?.goal || '');
    if (goalRole !== 'unknown') return goalRole;

    const scenario = String(agentTaskPlan?.designBrief?.scenario || '').trim();
    if (scenario === 'detail-page') return 'detailPage';
    if (scenario === 'sku') return 'sku';
    if (scenario === 'main-image') return 'mainImage';
    return 'unknown';
}

function normalizeOperationParamsForDesignRole(input: {
    toolName: string;
    params: unknown;
    agentTaskPlan?: AgentTaskPlanningContract;
    designDimensionSpec?: Partial<DesignDimensionSpec>;
}): unknown {
    if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) return input.params;
    const role = inferDesignDocumentRoleFromTaskPlan(input.agentTaskPlan);
    if (role === 'unknown') return input.params;
    const userOverrides = extractUserExplicitDocumentOverrides(
        input.agentTaskPlan?.designBrief?.goal || ''
    );
    if (input.toolName === 'createDocument') {
        return normalizeCreateDocumentParamsForDesignRole(role, input.params as Record<string, any>, {
            canonicalName: true,
            canonicalDimensions: true,
            dimensionSpec: input.designDimensionSpec,
            userOverrides
        });
    }
    if (input.toolName === 'renderLayout') {
        return normalizeLayoutParamsForDesignRole(role, input.params as Record<string, any>, {
            canonicalDimensions: true,
            dimensionSpec: input.designDimensionSpec,
            userOverrides
        });
    }
    return input.params;
}

function buildRequest(input: {
    agentTaskPlan?: AgentTaskPlanningContract;
    designDimensionSpec?: Partial<DesignDimensionSpec>;
    publicPlan?: AgentTaskPublicPlanExecutionPlanLike;
    status: AgentTaskPublicPlanExecutionRequestStatus;
    requestId?: string;
    userConfirmed?: boolean;
    canStartControlledRunner?: boolean;
    proposedWriteTools?: string[];
    allowedWriteTools?: string[];
    approvedWriteTools?: string[];
    blockedWriteTools?: string[];
    readbackTargets?: string[];
    blockers?: string[];
    warnings?: string[];
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
}): AgentTaskPublicPlanExecutionRequest {
    const proposedWriteTools = input.proposedWriteTools || [];
    const readbackTargets = input.readbackTargets || [];
    const canDescribeOperations =
        proposedWriteTools.length > 0
        && readbackTargets.length > 0
        && (input.blockedWriteTools || []).length === 0
        && ![
            'not_applicable',
            'blocked_public_plan_not_ready',
            'blocked_missing_write_tool_allowlist',
            'blocked_write_tool_not_allowed',
            'blocked_missing_readback_targets'
        ].includes(input.status);
    return {
        version: 'agent-task-public-plan-execution-request/v0',
        status: input.status,
        requestId: input.requestId,
        taskPlanStatus: input.agentTaskPlan?.status,
        publicPlanStatus: input.publicPlan?.status,
        writesPerformed: false,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: false,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiresExplicitUserConfirmation: true,
        requiresWriteToolAllowlist: true,
        requiresReadbackTargets: true,
        requiresControlledRunner: true,
        requiresReadbackAfterEachWrite: true,
        userConfirmed: input.userConfirmed === true,
        canStartControlledRunner: input.canStartControlledRunner === true,
        proposedWriteTools,
        allowedWriteTools: input.allowedWriteTools || [],
        approvedWriteTools: input.approvedWriteTools || [],
        blockedWriteTools: input.blockedWriteTools || [],
        readbackTargets,
        operationRequests: canDescribeOperations
            ? buildOperationRequests({
                agentTaskPlan: input.agentTaskPlan,
                designDimensionSpec: input.designDimensionSpec,
                proposedWriteTools,
                readbackTargets,
                executionPlanSummary: input.publicPlan?.executionPlanSummary,
                runtimeOperationRequests: input.runtimeOperationRequests
            })
            : [],
        publicPlanSummary: sanitizeText(input.publicPlan?.message),
        executionPlanSummary: sanitizeText(input.publicPlan?.executionPlanSummary),
        blockers: input.blockers || [],
        warnings: input.warnings || []
    };
}

export function buildAgentTaskPublicPlanExecutionRequest(
    input: BuildAgentTaskPublicPlanExecutionRequestInput
): AgentTaskPublicPlanExecutionRequest {
    const agentTaskPlan = input.agentTaskPlan;
    const publicPlan = input.publicPlan;
    const requestId = input.requestId || 'agent-task-public-plan-execution-request';
    const allowedWriteToolNormalization = normalizeWriteToolList(
        input.runtimeAllowedWriteTools && input.runtimeAllowedWriteTools.length > 0
            ? input.runtimeAllowedWriteTools
            : [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST],
        64
    );
    const allowedWriteTools = allowedWriteToolNormalization.values;
    const userConfirmed = input.userConfirmed === true;
    const runtimeOperationAliasWarnings = collectRuntimeOperationToolAliasWarnings(input.runtimeOperationRequests);
    const baseWarnings = mergeWarnings(
        allowedWriteToolNormalization.warnings,
        runtimeOperationAliasWarnings
    );

    if (!agentTaskPlan || !publicPlan) {
        return buildRequest({
            agentTaskPlan,
            designDimensionSpec: input.designDimensionSpec,
            publicPlan,
            status: 'not_applicable',
            requestId,
            userConfirmed,
            allowedWriteTools,
            warnings: baseWarnings,
            blockers: ['缺少公开计划或任务计划，不能创建受控执行请求。']
        });
    }

    if (
        agentTaskPlan.status !== 'ready_for_model_planning'
        || agentTaskPlan.executionPlan.requiresUserApproval !== true
        || publicPlan.status !== 'ready'
        || publicPlan.canExecuteTools !== false
    ) {
        return buildRequest({
            agentTaskPlan,
            designDimensionSpec: input.designDimensionSpec,
            publicPlan,
            status: 'blocked_public_plan_not_ready',
            requestId,
            userConfirmed,
            allowedWriteTools,
            warnings: baseWarnings,
            blockers: ['当前任务没有进入显式可审查方案流程，不能创建受控执行请求。']
        });
    }

    const rawProposedWriteTools = publicPlan?.proposedWriteTools && publicPlan.proposedWriteTools.length > 0
        ? publicPlan.proposedWriteTools
        : publicPlan?.writeToolAllowlist;
    const proposedWriteToolNormalization = normalizeWriteToolList(rawProposedWriteTools);
    const proposedWriteTools = proposedWriteToolNormalization.values;
    const readbackTargetResolution = resolveReadbackTargets({
        publicPlan,
        runtimeOperationRequests: input.runtimeOperationRequests
    });
    const requestWarnings = mergeWarnings(
        baseWarnings,
        proposedWriteToolNormalization.warnings,
        readbackTargetResolution.warnings
    );
    const isReadOnlyPlan = proposedWriteTools.length === 0
        && !hasExplicitEmptyWriteToolPlan(publicPlan)
        && readbackTargetResolution.values.length > 0;
    if (proposedWriteTools.length === 0 && !isReadOnlyPlan) {
        // 只读计划（评审/分析类）天然没有写工具诉求，不能因此卡死在
        // 「缺少写工具白名单」——确认后以空白名单进入受控执行（运行期写工具全部被拦，
        // 比任何写计划都安全）。只有「既无写工具又无读回目标」的空计划才视为不完整。
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_missing_write_tool_allowlist',
            requestId,
            userConfirmed,
            allowedWriteTools,
            warnings: requestWarnings,
            blockers: ['公开计划既没有写工具诉求也没有读回目标，不能进入用户确认或受控执行。']
        });
    }

    const approvedWriteTools = proposedWriteTools.filter((toolName) => allowedWriteTools.includes(toolName));
    const blockedWriteTools = proposedWriteTools.filter((toolName) => !allowedWriteTools.includes(toolName));
    if (blockedWriteTools.length > 0) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_write_tool_not_allowed',
            requestId,
            userConfirmed,
            proposedWriteTools,
            allowedWriteTools,
            approvedWriteTools,
            blockedWriteTools,
            warnings: requestWarnings,
            blockers: [`公开计划包含未获批准的写工具：${blockedWriteTools.join('、')}`]
        });
    }
    if (approvedWriteTools.length === 0 && !isReadOnlyPlan) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_missing_write_tool_allowlist',
            requestId,
            userConfirmed,
            proposedWriteTools,
            allowedWriteTools,
            blockedWriteTools,
            warnings: requestWarnings,
            blockers: ['公开计划没有任何在授权白名单内的写工具，也不是只读计划，无法进入受控执行。']
        });
    }

    const readbackTargets = readbackTargetResolution.values;
    if (readbackTargets.length === 0) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_missing_readback_targets',
            requestId,
            userConfirmed,
            proposedWriteTools,
            allowedWriteTools,
            warnings: requestWarnings,
            blockers: ['公开计划缺少执行后的读回验收目标，不能创建受控执行请求。']
        });
    }

    if (!userConfirmed) {
        return buildRequest({
            agentTaskPlan,
            designDimensionSpec: input.designDimensionSpec,
            publicPlan,
            status: 'blocked_pending_user_confirmation',
            requestId,
            userConfirmed,
            proposedWriteTools,
            allowedWriteTools,
            approvedWriteTools,
            readbackTargets,
            runtimeOperationRequests: input.runtimeOperationRequests,
            blockers: ['公开计划已具备工具白名单和读回目标，但仍缺少用户明确确认。'],
            warnings: mergeWarnings(requestWarnings, ['默认不允许写入 Photoshop；用户确认后才允许创建受控执行请求。'])
        });
    }

    if (input.enableControlledExecutionRequest !== true) {
        return buildRequest({
            agentTaskPlan,
            designDimensionSpec: input.designDimensionSpec,
            publicPlan,
            status: 'blocked_execution_request_disabled',
            requestId,
            userConfirmed,
            proposedWriteTools,
            allowedWriteTools,
            approvedWriteTools,
            readbackTargets,
            runtimeOperationRequests: input.runtimeOperationRequests,
            blockers: ['受控执行请求默认关闭，需要显式启用后才可交给受控 runner。'],
            warnings: mergeWarnings(requestWarnings, ['用户已确认公开计划，但本契约本身仍不写 Photoshop。'])
        });
    }

    return buildRequest({
        agentTaskPlan,
        designDimensionSpec: input.designDimensionSpec,
        publicPlan,
        status: 'ready_for_controlled_execution_request',
        requestId,
        userConfirmed,
        canStartControlledRunner: true,
        proposedWriteTools,
        allowedWriteTools,
        approvedWriteTools,
        readbackTargets,
        warnings: mergeWarnings(requestWarnings, ['受控执行请求已准备好；后续仍必须由受控 runner 按白名单和读回目标执行。']),
        runtimeOperationRequests: input.runtimeOperationRequests
    });
}

export function extractRuntimeOperationRequestsFromPublicPlanExecutionRequest(
    request?: AgentTaskPublicPlanExecutionRequest
): AgentTaskPublicPlanControlledOperationRequest[] {
    if (!request || !Array.isArray(request.operationRequests)) return [];
    return request.operationRequests
        .filter((operation) => operation && typeof operation === 'object' && operation.params !== undefined)
        .map((operation) => ({
            ...operation,
            params: sanitizeAgentResumePlanningValue(operation.params),
            readbackTargets: [...operation.readbackTargets]
        }));
}

export function stripRuntimeParamsFromPublicPlanExecutionRequest(
    request?: AgentTaskPublicPlanExecutionRequest
): AgentTaskPublicPlanExecutionRequest | undefined {
    if (!request) return undefined;
    return {
        ...request,
        operationRequests: request.operationRequests.map((operation) => ({
            operationId: operation.operationId,
            toolName: operation.toolName,
            paramsSummary: operation.paramsSummary,
            readbackTargets: [...operation.readbackTargets]
        }))
    };
}
