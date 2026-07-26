import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { buildCancelledAutonomousAgentResult } from './autonomous-agent-result-projection';
import {
    createAgentCapabilitySession,
    REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
    type AgentCapabilitySession
} from '../agent-runtime/capability-session';
import {
    DELEGATE_TOOL,
    TEAM_PIPELINE_TOOL,
    getDefaultAgentTools
} from '../agent-runtime/tool-schemas';
import { buildSkillToolSchemas, isSkillToolName, executeSkillTool } from './skill-tools';
import type {
    AgentCallbacks,
    AgentToolCallLogEntry,
    CallModelFn,
    CallModelStreamFn,
    ExecuteToolFn,
    RuntimeArtifactPublicationInput,
    ToolSchema
} from '../agent-runtime/types';
import { executeToolCall } from '../tool-executor.service';
import { streamChatWithToolsAsync } from '../agent-tool-stream.service';
import { useAppStore } from '../../stores/app.store';
import {
    getModelById,
    isConversationModelConfig,
    resolveModelThinkingEnabledForCall,
    type ModelConfig
} from '../../../shared/config/models.config';
import {
    formatChatWebSearchCompletedStep,
    formatChatWebSearchVisibleStep,
    toProviderNativeWebSearchIntent,
    type ChatWebSearchIntent
} from '../../../shared/chat-web-search-policy';
import { buildProviderNativeToolPlan } from '../../../shared/provider-native-tools';
import { resolveAgentModelTransport } from '../../../shared/agent-model-transport-policy';
import {
    classifyAgentToolExecution,
    DESIGN_ECHO_TARGET_GUARD_ARGUMENT,
    type AgentToolExecutionTargetGuard
} from '../../../shared/agent-tool-execution-preflight';
import {
    DesignTeamCoordinator,
    DesignTeamWorkspace,
    getDesignTeammateDefinition
} from '../design-teams';
import type { DesignTeammateRole } from '../../../shared/types/design-team.types';
import type { ConversationTaskType } from '../../../shared/model-selection';
import {
    deriveDesignTaskRunRecord,
    resolveDesignDisciplineContext,
    createDesignDisciplineState,
    applyDesignDisciplineProgress,
    evaluateDesignToolStateGuard,
    type DesignDisciplineContext,
    type DesignDisciplineState
} from '../../../shared/design-discipline-runtime';
import {
    evaluateHumanConfirmationGate,
    buildPendingDestructiveActionCard,
    buildPendingDestructiveActionBlockResult
} from '../../../shared/pending-destructive-action-card';
import { evaluateDelegatedToolSafetyBlock } from '../../../shared/tool-safety-policy';
import { buildAgentRunRecord } from '../../../shared/agent-run-record';
import { buildRunRecordResumeBrief } from '../../../shared/agent-run-resume';
import { AGENT_RESPONSE_PRESENTATION_PROMPT } from '../../../shared/agent-response-presentation';
import {
    buildRuntimeResumeContextAnchor,
    buildRuntimeResumeFreshnessProbeRequest,
    evaluateRuntimeActionPlanResumeFreshness,
    type RuntimeActionPlanResumeFreshness
} from '../../../shared/agent-runtime-v5/runtime-action-plan-resume-freshness';
import { markExternalContentTrust } from '../../../shared/external-content-trust';
import { resolveDesignIntentSignal } from '../../../shared/design-intent-signal';
import {
    getDesignTaskTypeSpec,
    getDesignTaskTypeSpecBySkillId,
    resolveDeclaredDesignTaskTypeIdFromControlPlaneSignals,
    resolveDesignTaskTypeSpec,
    isRegisteredDesignTaskTypeId
} from '../../../shared/design-task-types';
import {
    recordIntentShadowDivergence,
    isNotableIntentDivergence,
    type IntentShadowDivergenceRecord
} from '../../../shared/intent-shadow-diagnostics';
import {
    decideQualityAwareReflexionReentry,
    buildQualityLoopHaltMessage
} from '../../../shared/reflexion-reentry-policy';
import type { DesignScorecard } from '../../../shared/design-quality-assertion';
import type { ReflexionHandoff } from '../../../shared/agent-runtime-v5/reflexion-contract';
import { normalizeRuntimeDesignWorkMode } from '../../../shared/agent-runtime-v5/skill-runtime';
import {
    buildRuntimeContractBundleForAgentTask,
    type AgentTaskRuntimeContractBundle
} from '../../../shared/agent-runtime-v5/runtime-contract-bundle';
import {
    buildRuntimeContractStatus,
    validateRuntimeSelectedSkillHandoff,
    type RuntimeContractStatus,
    type RuntimeSelectedSkillHandoff
} from '../../../shared/agent-runtime-v5/runtime-selected-skill-handoff';
import {
    advanceRuntimeSessionGeneration,
    advanceRuntimeSessionIdentity,
    createRuntimeSessionIdentity,
    type RuntimeSession,
    type RuntimeSessionIdentity
} from '../../../shared/agent-runtime-v5/runtime-session';
import {
    buildRuntimePlanningContextSeed,
    type RuntimePlanningContextSeed,
    type RuntimePlanningDeclarations
} from '../../../shared/agent-runtime-v5/runtime-planning-context-seed';
import { readRuntimeTaskSnapshot } from '../../../shared/agent-runtime-v5/runtime-task-snapshot';
import {
    readArtifactRepositoryProjection,
    type ArtifactRepositoryReadProjection
} from '../../../shared/agent-runtime-v5/artifact-repository-contract';
import {
    RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
    RUNTIME_ARTIFACT_FINALIZATION_VERSION,
    readRuntimeArtifactAuthorizationGrant,
    type RuntimeArtifactAuthorizationGrant,
    type RuntimeArtifactFinalizationRequest
} from '../../../shared/agent-runtime-v5/runtime-artifact-finalization';
import {
    compileRuntimeContext,
    type RuntimeContextItem
} from '../../../shared/agent-runtime-v5/runtime-context-compiler';
import { buildAgentOperatingProfilePromptSection } from '../../../shared/agent-runtime-v5/agent-operating-profile';
import type { RuntimeDesignBriefAvailableInputSource } from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import {
    OPERATING_CONTEXT_RUNTIME_ITEM_ID,
    buildOperatingContextRuntimeItem,
    resolveOperatingPhotoshopConnection
} from '../../../shared/agent-runtime-v5/operating-context-snapshot';
import { buildDesignMethodKnowledgeContext } from '../../../shared/agent-runtime-v5/design-method-knowledge';
import {
    buildMultimodalModelDispatchPlan,
    formatPrimaryAgentDispatchPromptSection
} from '../../../shared/multimodal-model-dispatch';
import { buildPhotoshopToolSemanticsSummary } from '../../../shared/photoshop-tool-semantics';
import {
    buildAgentPerformancePolicy,
    buildAutonomousAgentRuntimeBudget,
    type AgentPerformancePolicy
} from '../../../shared/agent-performance-policy';
import {
    buildAgentIntentControlPlaneDecision,
    type AgentIntentControlPlaneDecision
} from '../../../shared/agent-intent-control-plane';
import type { DesignAgentOsScenario } from '../../../shared/design-agent-os-contracts';
import {
    buildDesignerAgentDecisionContract,
    buildDesignerAgentPromptSection
} from '../../../shared/designer-agent-decision-contract';
import { buildDesignerAgentAutonomyPrinciplesPromptSection } from '../../../shared/designer-agent-autonomy-principles';
import {
    buildDesignerAgentTeamConsultationContract,
    buildDesignerAgentTeamConsultationProgress
} from '../../../shared/designer-agent-team-consultation-contract';
import {
    buildDesignDocumentRoleContext,
    evaluateCreateDocumentTargetBoundary,
    extractUserExplicitDocumentOverrides,
    isCreateDocumentOperation,
    normalizeCreateDocumentParamsForDesignRole,
    normalizeLayoutParamsForDesignRole,
    type UserExplicitDocumentOverrides
} from '../../../shared/design-document-role';
import {
    resolveReferenceReplicationDeliveryScenario,
    resolveReferenceReplicationOutputIntent
} from '../../../shared/reference-replication-output-intent';
import {
    normalizeDesignDimensionSpec,
    summarizeDesignDimensionSpecForAgent,
    type DesignDimensionSpec
} from '../../../shared/design-dimension-spec';
import {
    checkPhotoshopBridgeReadiness,
    type PhotoshopBridgeReadiness
} from '../mcp-host.client';

function withDesignKnowledgeNativeTools(
    modelId: string,
    options?: Record<string, any>,
    requestWebSearchIntent?: ChatWebSearchIntent
): Record<string, any> | undefined {
    const model = getModelById(modelId);
    if (!model) return options;

    const state = useAppStore.getState();
    const hasExplicitNativeTools = Array.isArray(options?.nativeTools) && options.nativeTools.length > 0;
    if (hasExplicitNativeTools) return options;
    if (!requestWebSearchIntent) return options;

    const requestedWebSearch = toProviderNativeWebSearchIntent(requestWebSearchIntent, state.designKnowledgeSettings);
    if (!requestedWebSearch) return options;

    const providerNativeWebSearch = buildProviderNativeToolPlan({
        provider: model.provider,
        modelId: model.apiModelId || model.id,
        requestedTools: [requestedWebSearch]
    });

    if (providerNativeWebSearch.status !== 'ready') {
        return options;
    }

    return {
        ...options,
        nativeTools: providerNativeWebSearch.nativeTools
    };
}

type WebSearchVisibilityState = {
    intent?: ChatWebSearchIntent;
    callbacks?: AgentCallbacks;
    started: boolean;
    completed: boolean;
};

const WEB_SEARCH_TOOL_CALL_ID = 'provider-native-web-search';
const PROVIDER_NATIVE_WEB_SEARCH_MODEL_PRIORITY = [
    'xiaomi-mimo-v2.5-pro',
    'xiaomi-mimo-v2.5'
];

function hasProviderNativeWebSearch(options?: Record<string, any>): boolean {
    return Array.isArray(options?.nativeTools)
        && options.nativeTools.some((tool: any) => tool?.type === 'web_search');
}

function getProviderNativeWebSearchModelId(): string {
    const state = useAppStore.getState();
    const apiKeys = (state as any).apiKeys || {};
    return PROVIDER_NATIVE_WEB_SEARCH_MODEL_PRIORITY.find((modelId) => {
        const model = getModelById(modelId);
        if (!model || model.provider !== 'xiaomi') return false;
        const requiredApiKey = model.requiredApiKey;
        return !requiredApiKey || Boolean(String(apiKeys?.[requiredApiKey] || '').trim());
    }) || '';
}

function emitProviderNativeWebSearchStarted(state?: WebSearchVisibilityState) {
    if (!state?.intent || state.started) return;
    state.started = true;
    state.callbacks?.onStep?.({
        kind: 'tool_started',
        title: '联网搜索',
        detail: formatChatWebSearchVisibleStep(state.intent),
        status: 'running',
        toolName: 'providerNativeWebSearch',
        toolCallId: WEB_SEARCH_TOOL_CALL_ID
    });
}

function emitProviderNativeWebSearchCompleted(state?: WebSearchVisibilityState, response?: any) {
    if (!state?.intent || !state.started || state.completed) return;
    state.completed = true;
    const citationCount = Array.isArray(response?.citations) ? response.citations.length : 0;
    state.callbacks?.onStep?.({
        kind: 'tool_completed',
        title: '联网搜索完成',
        detail: formatChatWebSearchCompletedStep(state.intent, { citationCount }),
        status: 'success',
        toolName: 'providerNativeWebSearch',
        toolCallId: WEB_SEARCH_TOOL_CALL_ID
    });
}

function emitProviderNativeWebSearchFailed(state?: WebSearchVisibilityState) {
    if (!state?.intent || !state.started || state.completed) return;
    state.completed = true;
    state.callbacks?.onStep?.({
        kind: 'tool_completed',
        title: '联网搜索未完成',
        detail: `${formatChatWebSearchVisibleStep(state.intent)}（未完成）`,
        status: 'error',
        toolName: 'providerNativeWebSearch',
        toolCallId: WEB_SEARCH_TOOL_CALL_ID
    });
}

function toPlainModelMessages(messages: Parameters<CallModelFn>[1]): Array<Record<string, unknown>> {
    return messages.map((message) => {
        let content: unknown = String(message.content || '');
        if (Array.isArray(message.contentBlocks) && message.contentBlocks.length > 0) {
            content = message.contentBlocks.map((block) => {
                if (block.type === 'image') {
                    return {
                        type: 'image',
                        image: { data: block.data || '', mediaType: block.mediaType || 'image/png' }
                    };
                }
                return { type: 'text', text: block.text || '' };
            });
        }
        return { role: message.role, content };
    });
}

function createCallModelViaIPC(
    requestWebSearchIntent?: ChatWebSearchIntent,
    webSearchVisibility?: WebSearchVisibilityState
): CallModelFn {
    return async (modelId, messages, tools, options) => {
        const modelOptions = withDesignKnowledgeNativeTools(modelId, options, requestWebSearchIntent);
        const hasWebSearch = hasProviderNativeWebSearch(modelOptions);
        const hasProviderNativeTools = Array.isArray(modelOptions?.nativeTools)
            && modelOptions.nativeTools.length > 0;
        const transport = resolveAgentModelTransport({
            messages,
            toolCount: tools.length,
            hasProviderNativeTools
        });
        if (hasWebSearch) emitProviderNativeWebSearchStarted(webSearchVisibility);
        try {
            // 纯视觉观察/质量判定没有工具 schema，不应强迫视觉模型支持 function calling。
            // 但已经进入工具 / reasoning 协议的历史必须继续经 provider adapter 合法序列化。
            if (transport === 'plain_chat') {
                const response = await (window as any).designEcho.chat(
                    modelId,
                    toPlainModelMessages(messages),
                    modelOptions
                );
                return {
                    content: String(response?.text || ''),
                    thinking: response?.thinking,
                    usage: response?.usage,
                    stopReason: 'end_turn'
                };
            }
            const response = await (window as any).designEcho.chatWithTools(
                modelId,
                messages,
                tools,
                modelOptions
            );
            if (hasWebSearch) emitProviderNativeWebSearchCompleted(webSearchVisibility, response);
            return response;
        } catch (error) {
            if (hasWebSearch) emitProviderNativeWebSearchFailed(webSearchVisibility);
            throw error;
        }
    };
}

function createCallModelStreamViaIPC(
    requestWebSearchIntent?: ChatWebSearchIntent,
    webSearchVisibility?: WebSearchVisibilityState
): CallModelStreamFn {
    return async (modelId, messages, tools, options) => {
        const {
            onContentDelta,
            onThinkingDelta,
            onToolCallDelta,
            onToolCallReady,
            ...modelOptions
        } = options || {};

        const optionsWithNativeTools = withDesignKnowledgeNativeTools(modelId, {
            ...modelOptions,
            onContentDelta,
            onThinkingDelta,
            onToolCallDelta,
            onToolCallReady
        }, requestWebSearchIntent);
        const hasWebSearch = hasProviderNativeWebSearch(optionsWithNativeTools);
        if (hasWebSearch) emitProviderNativeWebSearchStarted(webSearchVisibility);

        try {
            const response = await streamChatWithToolsAsync(
                modelId,
                messages,
                tools,
                optionsWithNativeTools
            );
            if (hasWebSearch) emitProviderNativeWebSearchCompleted(webSearchVisibility, response);
            return response;
        } catch (error) {
            if (hasWebSearch) emitProviderNativeWebSearchFailed(webSearchVisibility);
            throw error;
        }
    };
}

const callModelViaIPC: CallModelFn = createCallModelViaIPC();
const callModelStreamViaIPC: CallModelStreamFn = createCallModelStreamViaIPC();

const FALLBACK_MODELS = ['google-gemini-3-flash', 'google-gemini-3-pro', 'local-qwen2.5-7b'];

// 委派安全纵深（治理审计 2026-07-08 既有盲区收口）：DesignTeamCoordinator 给设计队友子代理用的是
// 原始 executeToolCall，绕过主循环 createExecuteToolWrapper 的破坏性动作 hook / HITL 卡 / 外部内容
// 信任标记。当前队友工具集经 registry curation 不含任何安全策略拦截的工具（closeDocument/
// interactWithBrowserPage，由 smoke-teammate-tool-safety 钉死），故此绕过当前不可达。本 wrapper 补两层：
//  (1) 破坏性动作确定性硬拦：委派语境无人类确认通道，命中即硬拦并要求升级回主 Agent（忽略模型自带确认
//      参数，红线A）。防未来给某队友加入破坏性工具、或模型幻觉出未暴露的破坏性工具（executeToolCall 按
//      全局注册表执行、不做每-agent 允许集的执行层强制）。非破坏性工具零影响 → 当前零行为改变。
//  (2) markExternalContentTrust：与主 wrapper 对齐，给队友的外部内容工具结果（如 searchEagleReferences）
//      打 untrusted 标记，防间接提示注入经队友传导到下游。
// 边界（对抗核验 F1）：本硬拦只守在【顶层工具派发边界】，看不到复合工具内部对 gated 工具的嵌套裸调用；
// smoke 会扫描这类调用点，新增时必须显式复核其所属复合工具是否也应从队友能力面移除。
const executeToolForTeammate = async (toolName: string, params: any): Promise<any> => {
    const delegatedBlock = evaluateDelegatedToolSafetyBlock(toolName, params);
    if (delegatedBlock) {
        return {
            success: false,
            policyGate: true,
            safetyBlock: true,
            delegatedDestructiveBlocked: true,
            error: delegatedBlock.message
        };
    }
    return markExternalContentTrust(toolName, await executeToolCall(toolName, params));
};

const designTeamCoordinator = new DesignTeamCoordinator({
    callModel: callModelViaIPC,
    executeTool: executeToolForTeammate,
    resolveDefaultModelId: () => getModelId('logic')
});

async function executeDelegateToAgent(params: {
    role: DesignTeammateRole;
    task: string;
    context?: string;
}, callbacks?: AgentCallbacks, signal?: AbortSignal, workspace?: DesignTeamWorkspace, projectPath?: string): Promise<any> {
    const { role, task, context: taskContext } = params;

    if (!role) {
        return { success: false, error: 'Missing teammate role' };
    }

    emitTeammateActivityStep(callbacks, role, 'started');

    const result = await designTeamCoordinator.runTeammateTask(
        {
            role,
            task,
            context: taskContext
        },
        {
            onToolStart: (name) => console.log(`[DesignTeammate:${role}] ${name}`)
        },
        signal,
        // 同一次运行内共享团队工作区：后续委派自动看到前序队友成果；
        // 提供 projectPath 时产出写穿到 Design Project State
        { workspace, projectPath }
    );

    emitTeammateActivityStep(callbacks, role, result.success ? 'completed' : 'failed', result.error);

    return result;
}

async function executeRunDesignTeamPipeline(params: {
    goal: string;
    context?: string;
    maxRevisions?: number;
    projectPath?: string;
}, callbacks?: AgentCallbacks, signal?: AbortSignal, projectPath?: string): Promise<any> {
    const result = await designTeamCoordinator.runPipeline(
        {
            goal: String(params?.goal || ''),
            context: params?.context,
            maxRevisions: params?.maxRevisions,
            projectPath: params?.projectPath || projectPath
        },
        callbacks,
        signal
    );
    return {
        success: result.success,
        message: result.message,
        cancelled: result.cancelled,
        error: result.error,
        data: {
            goal: result.goal,
            stages: result.stages.map(s => ({
                stage: s.stage,
                role: s.role,
                success: s.success,
                iterations: s.iterations,
                toolsUsed: s.toolsUsed
            })),
            verdict: result.verdict
                ? { status: result.verdict.status, issues: result.verdict.issues }
                : undefined,
            revisionRounds: result.revisionRounds
        }
    };
}

function emitTeammateActivityStep(
    callbacks: AgentCallbacks | undefined,
    role: DesignTeammateRole,
    phase: 'started' | 'completed' | 'failed',
    error?: string
): void {
    const definition = getDesignTeammateDefinition(role);
    const label = definition?.displayName || role || 'Design Teammate';
    let titlePrefix = '子 Agent 失败';
    let status: 'running' | 'success' | 'error' = 'error';
    let kind: 'tool_started' | 'tool_completed' = 'tool_completed';

    if (phase === 'started') {
        titlePrefix = '开始子 Agent';
        status = 'running';
        kind = 'tool_started';
    } else if (phase === 'completed') {
        titlePrefix = '子 Agent 完成';
        status = 'success';
    }

    callbacks?.onStep?.({
        kind,
        title: `${titlePrefix}：${label}`,
        detail: error ? `子 Agent role: ${role}\n${error}` : `子 Agent role: ${role}`,
        status,
        toolName: `delegateToAgent:${role}`,
        toolCallId: `delegate-${role}`
    });
}

function readResultRecord(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
}

function readPrivateTargetGuard(value: unknown): AgentToolExecutionTargetGuard | undefined {
    const record = readResultRecord(value);
    const expectedDocumentId = record.expectedDocumentId;
    const expectedActiveLayerId = record.expectedActiveLayerId;
    const observationTool = String(record.observationTool || '').trim();
    if (!Number.isSafeInteger(expectedDocumentId) || expectedDocumentId <= 0 || !observationTool) {
        return undefined;
    }
    if (expectedActiveLayerId !== undefined
        && (!Number.isSafeInteger(expectedActiveLayerId) || expectedActiveLayerId <= 0)) {
        return undefined;
    }
    return {
        expectedDocumentId,
        ...(expectedActiveLayerId !== undefined ? { expectedActiveLayerId } : {}),
        observationTool
    };
}

function stripPrivateTargetGuard(params: Record<string, any>): Record<string, any> {
    const {
        [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: _privateTargetGuard,
        ...businessParams
    } = params || {};
    return businessParams;
}

function stripCreateDocumentPseudoConfirmation(params: Record<string, any>): Record<string, any> {
    const {
        confirmNewDocumentDespiteExisting: _modelAuthoredConfirmation,
        ...documentParams
    } = params || {};
    return documentParams;
}

function isToolWriteBoundToObservedActiveLayer(
    guard: AgentToolExecutionTargetGuard | undefined,
    params: Record<string, any>
): boolean {
    if (!guard) return false;
    const directLayerIds = [params?.layerId]
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0);
    const arrayLayerIds = Array.isArray(params?.layerIds)
        ? params.layerIds.map(Number).filter((value: number) => Number.isSafeInteger(value) && value > 0)
        : [];
    const targetLayerIds = [...directLayerIds, ...arrayLayerIds];
    // 私有 guard 只会在 Tool preflight 已确认 documentId 且所有显式 layerId 都来自成功读取/创建结果后签发。
    // 模型不能伪造它；这里消费该结构化绑定，不再要求 guard 重复携带 activeLayerId。
    return targetLayerIds.length > 0;
}

function countSuccessfulMutationCalls(result: {
    executionSummary?: { successfulMutationCalls?: number };
    toolCallLog?: AgentToolCallLogEntry[];
}): number {
    const summaryCount = Number(result.executionSummary?.successfulMutationCalls);
    const observedSummaryCount = Number.isSafeInteger(summaryCount) && summaryCount >= 0
        ? summaryCount
        : 0;
    const logCount = (result.toolCallLog || []).filter((entry) => {
        if (entry.result?.success === false) return false;
        const kind = classifyAgentToolExecution(entry.name, entry.arguments);
        return kind === 'photoshop_write' || kind === 'save_export';
    }).length;
    return Math.max(observedSummaryCount, logCount);
}

function cleanResultText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function readResultNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeDocumentNameForResultCheck(value: unknown): string {
    return cleanResultText(value)
        .replace(/\.(psd|psb)$/i, '')
        .toLowerCase();
}

function createDocumentNameMatches(expected: unknown, actual: unknown): boolean {
    const expectedName = normalizeDocumentNameForResultCheck(expected);
    const actualName = normalizeDocumentNameForResultCheck(actual);
    if (!expectedName || !actualName) return true;
    return expectedName === actualName
        || actualName.startsWith(`${expectedName} `)
        || actualName.startsWith(`${expectedName}-`)
        || actualName.startsWith(`${expectedName}_`);
}

function extractCreateDocumentResultRecord(result: unknown): Record<string, any> {
    const record = readResultRecord(result);
    const data = readResultRecord(record.data);
    return {
        ...readResultRecord(data.document),
        ...readResultRecord(record.document),
        ...record
    };
}

function buildCreateDocumentResultMismatch(input: {
    params: Record<string, any>;
    result: unknown;
}): string {
    const expectedName = cleanResultText(input.params.name);
    const expectedWidth = readResultNumber(input.params.width);
    const expectedHeight = readResultNumber(input.params.height);
    const actual = extractCreateDocumentResultRecord(input.result);
    const actualName = cleanResultText(actual.name);
    const actualWidth = readResultNumber(actual.width);
    const actualHeight = readResultNumber(actual.height);
    const blockers: string[] = [];

    if (expectedName && actualName && !createDocumentNameMatches(expectedName, actualName)) {
        blockers.push(`文档名称不一致：期望 ${expectedName}，实际 ${actualName}`);
    }
    if (expectedWidth !== undefined && actualWidth !== undefined && Math.round(expectedWidth) !== Math.round(actualWidth)) {
        blockers.push(`文档宽度不一致：期望 ${expectedWidth}，实际 ${actualWidth}`);
    }
    if (expectedHeight !== undefined && actualHeight !== undefined && Math.round(expectedHeight) !== Math.round(actualHeight)) {
        blockers.push(`文档高度不一致：期望 ${expectedHeight}，实际 ${actualHeight}`);
    }

    return blockers.join('；');
}

function readActiveDocumentNameFromResult(result: unknown): string {
    const record = readResultRecord(result);
    const data = readResultRecord(record.data);
    const document = {
        ...readResultRecord(data.document),
        ...readResultRecord(record.document)
    };
    return cleanResultText(
        document.name
        || record.documentName
        || data.documentName
        || record.activeDocumentName
        || data.activeDocumentName
    );
}

function hasSuccessfulNestedToolExecution(result: unknown, toolName: string): boolean {
    const record = readResultRecord(result);
    const data = readResultRecord(record.data);
    let toolResults: unknown[] = [];
    if (Array.isArray(record.toolResults)) {
        toolResults = record.toolResults;
    } else if (Array.isArray(data.toolResults)) {
        toolResults = data.toolResults;
    }
    return toolResults.some((item: unknown) => {
        const observation = readResultRecord(item);
        const nestedResult = readResultRecord(observation.result);
        return cleanResultText(observation.toolName) === toolName
            && nestedResult.success === true;
    });
}

function createExecuteToolWrapper(
    callbacks?: AgentCallbacks,
    signal?: AbortSignal,
    context?: any,
    autonomousParams?: Record<string, any>,
    designerTeamConsultationContract?: ReturnType<typeof buildDesignerAgentTeamConsultationContract> | null,
    capabilitySession?: AgentCapabilitySession,
    dimensionSpec?: DesignDimensionSpec,
    userDocumentOverrides?: UserExplicitDocumentOverrides
): ExecuteToolFn {
    // 每次自主运行一个团队工作区：多次委派之间自动共享队友成果
    const teamWorkspace = new DesignTeamWorkspace();
    const projectPath: string | undefined = context?.projectContext?.projectPath;
    const completedDesignTeamRoles = new Set<DesignTeammateRole>();
    let designTeamPipelineCompleted = false;
    // A1.2：原详情页专属状态机已下沉为通用纪律（design-discipline-runtime）。
    // 去硬编码意图（Step2，并集增量）：纪律激活不再只靠"进循环前的关键词意图判定"，而是
    //   旧激活信号 OR 模型实际行为足迹/声明（resolveDesignIntentSignal，不读用户措辞关键词）。
    // 干净说法仍由旧信号早激活、行为零回归；旧正则漏判的说法（如"做促销海报"）在模型真动手做设计后
    // 由行为足迹补激活——不新开看图红线窗口（窗口期与今天对这类说法行为一致），一旦激活即缓存不回退。
    const baseDisciplineContext = resolveAutonomousDesignDisciplineContext(autonomousParams, context);
    let activeDisciplineContext: DesignDisciplineContext | null =
        baseDisciplineContext.active ? baseDisciplineContext : null;
    const designBehaviorLog: Array<{ name?: string; result?: any }> = [];
    // V2「意图交给 Agent 理解」P1 影子对比（零真实激活改动）：捕获模型经 declareDesignIntent 自主声明的
    // taskType（走独立影子变量，绝不接入真实激活/bind 通道）+ 累积"若以模型声明作主判据 vs 当前真实激活"
    // 的分歧记录，供 P3 翻转前的客观决策（样本量 + 分歧率）。此处只记录、不改变任何激活行为。
    let latestShadowDeclaredTaskTypeId: string | undefined;
    const intentShadowLog: IntentShadowDivergenceRecord[] = [];
    const resolveDisciplineContextForCall = (): DesignDisciplineContext => {
        if (activeDisciplineContext) return activeDisciplineContext;
        const signal = resolveDesignIntentSignal({
            toolCallLog: designBehaviorLog,
            declaredTaskType: autonomousParams?.declaredTaskType,
            skillId: autonomousParams?.skillId,
            // 纵深防御：真实激活也只采信已注册品类的声明 id（当前该字段休眠，无 live 影响，纯硬化）。
            isValidTaskTypeId: isRegisteredDesignTaskTypeId
        });
        if (!signal.isDesign) return baseDisciplineContext;
        // 复用 baseDisciplineContext 已计算的参考/团队/交互布尔（避免重算，也不新增品类专属符号）。
        const resolved = resolveDesignDisciplineContext({
            taskText: getAutonomousTaskText(autonomousParams, context),
            isCreativeDesignIntent: true,
            // 声明式任务类型优先（评审修复 2026-07-03）：模型/上游声明的 taskTypeId 直接查表激活，
            // 不受 taskText 里 excludeSignals 措辞（如确认卡重提交文本中的「出图」）误杀。
            declaredTaskTypeId: signal.taskTypeId || resolveDeclaredDesignTaskTypeIdForAutonomousRun(autonomousParams),
            hasReferenceSource: baseDisciplineContext.hasReferenceSource,
            activeDocumentName: resolveCurrentPhotoshopDocumentName(context)
        });
        // 只缓存已激活上下文：避免一次被排除文本判为 inactive 后永久钉死，堵住后续移交激活通道。
        if (!resolved.active) return resolved;
        activeDisciplineContext = resolved;
        return activeDisciplineContext;
    };
    /**
     * 移交续跑的确定性纪律激活（评审修复 2026-07-03）：工具结果携带 declaredDesignTaskTypeId
     * （如上游工作流因缺少前置能力而移交设计任务）时，立即以该任务类型
     * 激活纪律上下文——发生在设计动作（createDocument 等）之前，参考先行门禁因此可达；
     * 不依赖用户措辞正则，也不等行为足迹（足迹激活必然晚于首次 createDocument）。通用通道，
     * 任何品类的移交契约都可复用，executor 不含品类字面量。
     */
    const bindDeclaredDisciplineContextFromToolResult = (result: unknown): void => {
        const declaredTaskTypeId = readDeclaredDesignTaskTypeIdFromToolResult(result);
        if (!declaredTaskTypeId) return;
        if (activeDisciplineContext?.active && activeDisciplineContext.taskTypeId === declaredTaskTypeId) return;
        const rebound = resolveDesignDisciplineContext({
            taskText: getAutonomousTaskText(autonomousParams, context),
            isCreativeDesignIntent: true,
            declaredTaskTypeId,
            hasReferenceSource: baseDisciplineContext.hasReferenceSource,
            activeDocumentName: resolveCurrentPhotoshopDocumentName(context)
        });
        if (rebound.active) activeDisciplineContext = rebound;
    };
    // V0-4 重入播种（治理审计 2026-07-08）：reflexion 重入会用 createExecuteToolWrapper 新建
    // disciplineState（默认全 false）。若不回灌上一轮已确证的画布/排版事实，续跑 brief 说
    // 「文档已存在、直接置图」而纪律分支 4.1 因 documentCreated=false 强制 createDocument，
    // 在存量画布旁另建空文档。仅在重入轮（reflexionReentryInProgress）用上一轮 run-record
    // checkpoint 派生的确定性旗标播种；首轮或无种子时回退全 false，行为与旧版一致。
    const reflexionDisciplineSeed = autonomousParams?.reflexionReentryInProgress === true
        ? (autonomousParams?.reflexionDisciplineSeed as Partial<DesignDisciplineState> | undefined)
        : undefined;
    let disciplineState: DesignDisciplineState = createDesignDisciplineState(reflexionDisciplineSeed);
    const designDocumentRoleContext = buildDesignDocumentRoleContext({
        userInput: getAutonomousTaskText(autonomousParams, context),
        currentDocumentName: resolveCurrentPhotoshopDocumentName(context),
        workMode: normalizeRuntimeDesignWorkMode(autonomousParams?.declaredWorkMode)
    });
    const protectedDocumentName = designDocumentRoleContext.currentDocumentName;
    let activeDocumentWriteProtected = designDocumentRoleContext.currentDocumentUse === 'protected'
        || designDocumentRoleContext.currentDocumentUse === 'separate_target'
        || designDocumentRoleContext.currentDocumentUse === 'observe_only';

    // 始终跟踪纪律状态（即便尚未激活）：让行为足迹激活后状态与现实一致，避免 documentCreated 等漏记导致误拦。
    const recordDesignDisciplineProgress = (
        frameworkToolName: string,
        toolName: string,
        result: AgentResult | any,
        isPhotoshopMutation: boolean
    ) => {
        disciplineState = applyDesignDisciplineProgress(
            disciplineState,
            toolName,
            result?.success !== false,
            { frameworkToolName, isPhotoshopMutation }
        );
    };

    return async (toolName, params, runtimeContext) => {
        const hasPrivateTargetGuard = Object.prototype.hasOwnProperty.call(
            params || {},
            DESIGN_ECHO_TARGET_GUARD_ARGUMENT
        );
        const privateTargetGuard = readPrivateTargetGuard(
            params?.[DESIGN_ECHO_TARGET_GUARD_ARGUMENT]
        );
        if (hasPrivateTargetGuard && !privateTargetGuard) {
            return {
                success: false,
                policyGate: true,
                targetGuardCheckFailed: true,
                error: '执行目标守卫无效，已停止执行。请重新读取当前 Photoshop 文档后再试。'
            };
        }
        // 私有 target guard 只属于最终 UXP 执行边界。先从业务参数中剥离，避免进入
        // HITL 卡、设计纪律、参数归一化、Skill normalizedParams 或用户可见结果；
        // 原子工具在真正 executeToolCall 前再临时附回。
        params = stripPrivateTargetGuard(params || {});
        if (isCreateDocumentOperation(toolName, params)) {
            params = stripCreateDocumentPseudoConfirmation(params);
        }

        if (toolName === REQUEST_AGENT_CAPABILITIES_TOOL_NAME) {
            if (!capabilitySession) {
                return {
                    success: false,
                    error: '当前运行没有 Capability Session，无法按需装载能力。'
                };
            }
            const requestedCapabilityIds = Array.isArray(params?.capabilityIds)
                ? params.capabilityIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
                : [];
            const activation = capabilitySession.requestCapabilities(requestedCapabilityIds);
            const alreadyActiveOnly = activation.status === 'rejected'
                && activation.issues.length > 0
                && activation.issues.every((issue) => (
                    issue.code === 'requested_capability_already_active'
                ));
            let message = `已为下一步装载 ${activation.activatedCapabilityIds.length} 项能力；本次没有执行 Photoshop 动作。`;
            if (alreadyActiveOnly) {
                message = '你请求的能力已经可用，请直接调用它提供的具体动作；本次没有重复装载，也没有执行 Photoshop。';
            } else if (activation.status === 'rejected') {
                message = '没有装载新的能力；请只选择当前目录中尚未启用且未被禁止的能力。';
            }
            return {
                success: activation.status !== 'rejected' || alreadyActiveOnly,
                message,
                data: {
                    ...activation,
                    changesModelVisibleSchemasOnly: true,
                    executesPhotoshop: false,
                    grantsPermission: false,
                    countsAsObservation: false,
                    countsAsTaskProgress: false
                }
            };
        }

        // 安全是全局最外层，独立于"是不是设计任务"（治理审计 2026-07-08）。V1-7b 正版 HITL：
        // 真正不可逆或外部敏感动作（不保存关档、真实浏览器 click…）命中 → 暂存本次确切调用 + 产人类确认卡 + 暂停循环，
        // 等用户在卡上确认后由 ChatPanel 确定性重放暂存的原始调用（红线 B）。evaluateHumanConfirmationGate 先剥离
        // 模型自带的确认参数再裁决——模型在自主循环里无法自我确认破坏性动作（红线 A：未经真人确认绝不执行）。
        // 返回值保留 policyGate/safetyBlock（通用循环豁免熔断/no_progress，且收集门据 safetyBlock 收集卡触发暂停）。
        const humanConfirmationGate = evaluateHumanConfirmationGate(toolName, params);
        if (humanConfirmationGate) {
            const pendingDestructiveCard = buildPendingDestructiveActionCard({
                verdict: humanConfirmationGate.verdict,
                toolName,
                params: humanConfirmationGate.strippedParams
            });
            return buildPendingDestructiveActionBlockResult({
                verdict: humanConfirmationGate.verdict,
                card: pendingDestructiveCard
            });
        }

        const disciplineContext = resolveDisciplineContextForCall();
        const designDisciplineActive = disciplineContext.active;
        // 任务类型声明只提供文档角色提示；无法识别时必须保持 unknown，不能把任意设计
        // 偷偷规范化成详情页名称、尺寸或 preset。
        const targetDocumentRole = disciplineContext.spec?.runtimeHints.documentRole
            || designDocumentRoleContext.targetRole;
        let toolParams = designDisciplineActive && toolName === 'createDocument'
            ? normalizeCreateDocumentParamsForDesignRole(
                targetDocumentRole,
                params,
                {
                    canonicalName: true,
                    canonicalDimensions: true,
                    dimensionSpec,
                    userOverrides: userDocumentOverrides
                }
            )
            : designDisciplineActive && toolName === 'renderLayout'
                ? normalizeLayoutParamsForDesignRole(
                    targetDocumentRole,
                    params,
                    {
                        canonicalDimensions: true,
                        dimensionSpec,
                        userOverrides: userDocumentOverrides
                    }
                )
                : params;
        const createDocumentTargetBoundary = evaluateCreateDocumentTargetBoundary(
            designDocumentRoleContext
        );
        const createsDocument = isCreateDocumentOperation(toolName, toolParams);
        if (createsDocument && !createDocumentTargetBoundary.allowed) {
            return {
                success: false,
                policyGate: true,
                code: createDocumentTargetBoundary.code,
                message: createDocumentTargetBoundary.message,
                error: createDocumentTargetBoundary.message,
                ...(createDocumentTargetBoundary.nextRequiredTool
                    ? {
                        nextRequiredTool: createDocumentTargetBoundary.nextRequiredTool,
                        nextRequiredToolReason: '先重新绑定既有 Photoshop 目标，再决定后续动作。'
                    }
                    : {})
            };
        }
        const executionKind = classifyAgentToolExecution(toolName, toolParams);
        const exactObservedLayerWrite = designDocumentRoleContext.currentDocumentUse === 'observe_only'
            && isToolWriteBoundToObservedActiveLayer(privateTargetGuard, toolParams);
        const changesProtectedDocument = activeDocumentWriteProtected
            && !exactObservedLayerWrite
            && !createsDocument
            && toolName !== 'openProjectFile'
            && toolName !== 'switchDocument'
            && (
                executionKind === 'photoshop_write'
                || executionKind === 'save_export'
                || ['closeDocument', 'undo', 'redo'].includes(toolName)
            );
        if (changesProtectedDocument) {
            const mayCreateSeparateTarget = createDocumentTargetBoundary.allowed;
            const message = designDocumentRoleContext.currentDocumentUse === 'protected'
                ? `用户明确要求保护当前文档「${protectedDocumentName || '未命名文档'}」，已阻止对它执行修改、保存或导出。`
                : `当前文档「${protectedDocumentName || '未命名文档'}」尚未绑定为本任务的写入目标，已阻止在错误文档上继续。`;
            return {
                success: false,
                policyGate: true,
                code: 'current_document_write_protected',
                message,
                error: message,
                nextRequiredTool: mayCreateSeparateTarget ? 'createDocument' : 'listDocuments',
                nextRequiredToolReason: mayCreateSeparateTarget
                    ? '本任务已明确需要独立交付目标，可以建立或切换到独立目标文档。'
                    : '先读取并绑定既有文档目标，不能用新建文档代替目标确认。'
            };
        }
        const designDisciplineGuardResult = evaluateDesignToolStateGuard({
            context: disciplineContext,
            state: disciplineState,
            toolName,
            toolParams,
            isPhotoshopMutation: executionKind === 'photoshop_write',
            trustedCreateDocumentAuthorization: createsDocument
                && createDocumentTargetBoundary.allowed
                && ['protected', 'separate_target'].includes(designDocumentRoleContext.currentDocumentUse)
        });
        if (designDisciplineGuardResult) {
            // 纪律守卫是"策略重定向/门禁"，不是工具执行失败：打 policyGate，切断
            // "策略否决→连续失败熔断→no_progress 停机"这条把 1-bit 误判放大成任务崩溃的链（治理审计 2026-07-08）。
            return { ...designDisciplineGuardResult, policyGate: true };
        }
        if (toolName === 'delegateToAgent') {
            const result = await executeDelegateToAgent(toolParams, callbacks, signal, teamWorkspace, projectPath);
            if (result?.success !== false) {
                const role = String(toolParams?.role || '').trim() as DesignTeammateRole;
                if (role) {
                    completedDesignTeamRoles.add(role);
                }
            }
            return result;
        }
        if (toolName === 'runDesignTeamPipeline') {
            if (privateTargetGuard) {
                const targetCheck = await executeToolCall('getDocumentInfo', {
                    [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: privateTargetGuard
                }, { signal });
                if (targetCheck?.success === false) {
                    return {
                        ...targetCheck,
                        success: false,
                        policyGate: true,
                        targetGuardCheckFailed: true,
                        error: targetCheck?.error
                            || 'Photoshop 执行目标已变化，团队工作流未开始。请重新读取当前文档后再试。'
                    };
                }
            }
            const result = await executeRunDesignTeamPipeline(toolParams, callbacks, signal, projectPath);
            if (result?.success !== false) {
                designTeamPipelineCompleted = true;
            }
            return result;
        }
        const designTeamProgress = buildDesignerAgentTeamConsultationProgress({
            contract: designerTeamConsultationContract,
            completedRoles: Array.from(completedDesignTeamRoles),
            pipelineCompleted: designTeamPipelineCompleted,
            phase: executionKind === 'save_export' ? 'after_draft' : 'before_write'
        });
        if (
            designerTeamConsultationContract?.status === 'required'
            && !designTeamProgress.readyForWrite
            && ['photoshop_write', 'save_export'].includes(executionKind)
        ) {
            const message = [
                executionKind === 'save_export'
                    ? '这次需要先完成专业评审，再保存或导出。'
                    : '这次需要先完成专业角色判断，再开始改动画面。',
                designTeamProgress.publicMessage,
                designTeamProgress.nextRequiredRole
                    ? `下一步请先让 ${designTeamProgress.nextRequiredRole} 完成对应判断。`
                    : ''
            ].filter(Boolean).join('\n');
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'delegateToAgent',
                nextRequiredToolReason: '专业角色建议完成后，主 Agent 再汇总并决定是否写入画面。'
            };
        }
        // 技能（多步工作流）在循环内以工具形式调用，约束在执行点强制
        if (isSkillToolName(toolName)) {
            const skillBusinessParams = toolParams || {};
            if (privateTargetGuard) {
                // Workflow bridge 内部会继续派发多个原子动作。先让 UXP 的同一 guard owner
                // 对当前活动文档/图层做一次 fail-closed 校验，再剥离私有参数进入业务 Skill；
                // 私有守卫不得进入 normalizedParams、Skill 结果或模型可见业务数据。
                const targetCheck = await executeToolCall('getDocumentInfo', {
                    [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: privateTargetGuard
                }, { signal });
                if (targetCheck?.success === false) {
                    return {
                        ...targetCheck,
                        success: false,
                        policyGate: true,
                        targetGuardCheckFailed: true,
                        error: targetCheck?.error
                            || 'Photoshop 执行目标已变化，工作流未开始。请重新读取当前文档后再试。'
                    };
                }
            }
            const result = await executeSkillTool(toolName, skillBusinessParams, {
                // Skill 对外只呈现工作流阶段；内部原子工具结果仍由 Skill 记录并用于验收，
                // 不再逐条抬升为用户侧顶层步骤。外层 Agent 已显示 Skill 的开始与完成。
                callbacks: callbacks ? {
                    ...callbacks,
                    onToolStart: undefined,
                    onToolComplete: undefined
                } : callbacks,
                signal,
                context,
                runtimeDesignBriefDeclaration: runtimeContext?.runtimeDesignBriefDeclaration,
                runtimeDesignBriefDigest: runtimeContext?.runtimeDesignBriefDigest,
                runtimeDesignBriefRequiredInputKeys: runtimeContext?.runtimeDesignBriefRequiredInputKeys,
                runtimeReferenceBriefDeclaration: runtimeContext?.runtimeReferenceBriefDeclaration,
                runtimeReferenceBriefDigest: runtimeContext?.runtimeReferenceBriefDigest,
                runtimeDesignStrategyDeclaration: runtimeContext?.runtimeDesignStrategyDeclaration,
                runtimeDesignStrategyDigest: runtimeContext?.runtimeDesignStrategyDigest,
                runtimeActionPlanDeclaration: runtimeContext?.runtimeActionPlanDeclaration,
                runtimeActionPlanDigest: runtimeContext?.runtimeActionPlanDigest
            });
            recordDesignDisciplineProgress(
                disciplineContext.frameworkToolName,
                toolName,
                result,
                executionKind === 'photoshop_write'
            );
            bindDeclaredDisciplineContextFromToolResult(result);
            // H3：先完成外部内容信任标记，再更新本地文档保护状态；后者不能绕过或替代信任边界。
            const trustedResult = markExternalContentTrust(toolName, result);
            if (result?.success !== false && hasSuccessfulNestedToolExecution(result, 'createDocument')) {
                activeDocumentWriteProtected = false;
            }
            return trustedResult;
        }
        // H3：外部内容（网页/第三方库）进模型前打 untrusted 标记——数据不是指令（内部工具原样返回）
        const atomicExecutionParams = privateTargetGuard
            ? {
                ...toolParams,
                [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: privateTargetGuard
            }
            : toolParams;
        const result = markExternalContentTrust(
            toolName,
            await executeToolCall(toolName, atomicExecutionParams, { signal })
        );
        if (designDisciplineActive && toolName === 'createDocument' && result?.success !== false) {
            const mismatch = buildCreateDocumentResultMismatch({
                params: toolParams,
                result
            });
            if (mismatch) {
                const docLabel = disciplineContext.canonicalDocumentName || disciplineContext.label || '目标';
                return {
                    success: false,
                    message: `新建${docLabel}文档结果不一致，已停止继续写入。${mismatch}`,
                    error: `createDocument_result_mismatch: ${mismatch}`,
                    nextRequiredTool: 'createDocument',
                    nextRequiredToolReason: `Photoshop 返回的活动文档和请求的${docLabel}文档不一致，不能继续在错误文档上排版。`
                };
            }
        }
        if (result?.success !== false && (toolName === 'createDocument' || toolName === 'openProjectFile')) {
            activeDocumentWriteProtected = false;
        } else if (result?.success !== false && toolName === 'switchDocument') {
            const activeDocumentName = readActiveDocumentNameFromResult(result);
            if (activeDocumentName) {
                activeDocumentWriteProtected = normalizeDocumentNameForResultCheck(activeDocumentName)
                    === normalizeDocumentNameForResultCheck(protectedDocumentName);
            }
        }
        recordDesignDisciplineProgress(
            disciplineContext.frameworkToolName,
            toolName,
            result,
            executionKind === 'photoshop_write'
        );
        designBehaviorLog.push({ name: toolName, result });
        bindDeclaredDisciplineContextFromToolResult(result);
        // P1 影子采样（每次工具调用独立算，不受 resolveDisciplineContextForCall 缓存短路影响，
        // 故能采到 task_type_mismatch 与激活后窗口——核验必改②）：更新模型影子声明，再比对
        // "影子(模型声明作主判据) vs 真实激活(关键词门 OR 足迹)"。只落分歧日志，绝不改变激活行为。
        const shadowDeclared = readShadowDeclaredDesignTaskTypeIdFromToolResult(result);
        if (shadowDeclared) latestShadowDeclaredTaskTypeId = shadowDeclared;
        const shadowSignal = resolveDesignIntentSignal({
            toolCallLog: designBehaviorLog,
            declaredTaskType: latestShadowDeclaredTaskTypeId,
            skillId: autonomousParams?.skillId,
            isValidTaskTypeId: isRegisteredDesignTaskTypeId
        });
        const divergence = recordIntentShadowDivergence(
            {
                active: Boolean(activeDisciplineContext?.active),
                taskTypeId: activeDisciplineContext?.taskTypeId,
                source: 'keyword_or_footprint'
            },
            { active: shadowSignal.isDesign, taskTypeId: shadowSignal.taskTypeId, source: shadowSignal.source }
        );
        intentShadowLog.push(divergence);
        if (isNotableIntentDivergence(divergence)) {
            // 分歧可见性：真实分歧（模型声明会更早/更准激活）落一条 agent 受众诊断，供真机观测采样，
            // 不进用户对话（避免噪声）。P3 翻转阈值对齐时读 summarizeIntentShadowLog(intentShadowLog)。
            console.info('[intent-shadow]', divergence.divergenceKind, JSON.stringify({ real: divergence.real, shadow: divergence.shadow }));
        }
        return result;
    };
}

function getAutonomousTaskText(params?: Record<string, any>, context?: any): string {
    return String(
        params?.userTask
        || params?.task
        || params?.userInput
        || context?.userInput
        || ''
    ).trim();
}

function resolveCurrentPhotoshopDocumentPresence(context?: any): boolean | undefined {
    const snapshot = context?.operatingContextSnapshot;
    if (snapshot) {
        if (snapshot.photoshop?.observation?.freshness !== 'current') return undefined;
        if (snapshot.photoshop.documentState === 'present') return true;
        if (snapshot.photoshop.documentState === 'absent') return false;
        return undefined;
    }
    return context?.photoshopContext?.hasDocument;
}

function resolveCurrentPhotoshopConnection(context?: any): boolean | undefined {
    if (context?.operatingContextSnapshot) {
        return resolveOperatingPhotoshopConnection(context.operatingContextSnapshot);
    }
    return context?.isPluginConnected;
}

function resolveCurrentPhotoshopDocumentName(context?: any): string | undefined {
    if (resolveCurrentPhotoshopDocumentPresence(context) !== true) return undefined;
    return context?.operatingContextSnapshot?.photoshop?.document?.name
        || context?.photoshopContext?.documentName;
}

function hasResolvedRuntimeInputValue(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return Boolean(value.trim());
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
}

function toCamelInputKey(inputKey: string): string {
    return inputKey.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function buildAutonomousDesignBriefInputSources(input: {
    params: Record<string, any>;
    context?: any;
    runtimeContractBundle: AgentTaskRuntimeContractBundle;
}): RuntimeDesignBriefAvailableInputSource[] {
    const inputKeys = Object.keys(input.runtimeContractBundle.stagePlan.inputSources);
    const structuredRecords = [
        input.params.skillParams,
        input.params
    ].filter((value) => value && typeof value === 'object' && !Array.isArray(value)) as Record<string, unknown>[];
    const structuredInputKeys = inputKeys.filter((inputKey) => {
        const aliases = [inputKey, toCamelInputKey(inputKey)];
        return structuredRecords.some((record) => aliases.some((alias) => (
            hasResolvedRuntimeInputValue(record[alias])
        )));
    });
    const project = input.context?.projectContext || {};
    const photoshop = input.context?.photoshopContext || {};
    const projectAssetCount = Math.max(
        Number(project.projectImageCount || 0),
        Number(project.assetIndex?.summary?.totalImages || 0),
        Array.isArray(project.sampleImagePaths) ? project.sampleImagePaths.length : 0
    );
    const contextProduct = project.contextSnapshot?.payload?.product
        || project.contextSnapshot?.product;
    const hasProjectProduct = Boolean(contextProduct && typeof contextProduct === 'object' && (
        String(contextProduct.name || '').trim()
        || String(contextProduct.category || '').trim()
        || (Array.isArray(contextProduct.facts) && contextProduct.facts.length > 0)
        || (Array.isArray(contextProduct.visibleFeatures) && contextProduct.visibleFeatures.length > 0)
    ));
    return [
        ...(structuredInputKeys.length > 0
            ? [{ sourceKind: 'structured_input' as const, inputKeys: structuredInputKeys }]
            : []),
        ...(projectAssetCount > 0 ? [{ sourceKind: 'project_asset' as const }] : []),
        ...(String(project.selectedProjectImagePath || '').trim()
            ? [{ sourceKind: 'selected_project_asset' as const }]
            : []),
        ...(hasProjectProduct ? [{ sourceKind: 'project_product' as const }] : []),
        ...(project.hasSkuFiles === true ? [{ sourceKind: 'project_sku' as const }] : []),
        ...(project.hasTemplates === true ? [{ sourceKind: 'project_template' as const }] : []),
        ...(project.projectId || project.projectPath || project.contextSnapshot
            ? [{ sourceKind: 'project_context' as const }]
            : []),
        ...(photoshop.activeLayerId || String(photoshop.activeLayerName || '').trim()
            ? [{ sourceKind: 'photoshop_target' as const }]
            : [])
    ];
}

function isAutonomousCreativeDesignTask(
    params?: Record<string, any>,
    context?: any
): boolean {
    const controlPlane = params?.agentIntentControlPlane;
    if (controlPlane && typeof controlPlane === 'object' && !Array.isArray(controlPlane)) {
        return controlPlane.requestKind === 'autonomous_execution'
            && Array.isArray(controlPlane.matchedSignals)
            && controlPlane.matchedSignals.includes('explicit_creative_design');
    }

    const userTask = String(params?.userTask || params?.task || params?.userInput || context?.userInput || '').trim();
    if (!userTask) return false;
    const inferred = buildAgentIntentControlPlaneDecision({
        userInput: userTask,
        hasDocument: resolveCurrentPhotoshopDocumentPresence(context),
        photoshopConnected: resolveCurrentPhotoshopConnection(context)
    });
    return inferred.requestKind === 'autonomous_execution'
        && inferred.matchedSignals.includes('explicit_creative_design');
}

/**
 * 解析本轮的「声明式任务类型 id」（评审修复 2026-07-03，全程无品类字面量）：
 *   1) params.declaredTaskType —— 既有结构化声明通道（模型声明 / 上游显式传参）；
 *   2) 控制面 matchedSignals 经共享数据映射（CONTROL_PLANE_SIGNAL_TASK_TYPE_MAP）翻译——
 *      部分品类的控制面信号不含 explicit_creative_design（如 SKU 模板设计只发
 *      sku_template_design_autonomy），纪律激活不能只挂在创意信号上。
 * 品类知识都在 shared/design-task-types.ts 数据层，executor 只做通道透传。
 */
function resolveDeclaredDesignTaskTypeIdForAutonomousRun(
    params?: Record<string, any>
): string | undefined {
    const direct = String(params?.declaredTaskType || '').trim();
    if (direct) return direct;
    return resolveDeclaredDesignTaskTypeIdFromControlPlaneSignals(
        params?.agentIntentControlPlane?.matchedSignals
    );
}

/** 通用读取：工具结果携带的声明式任务类型 id（移交契约 data.declaredDesignTaskTypeId）。 */
function readDeclaredDesignTaskTypeIdFromToolResult(result: unknown): string {
    const record = result && typeof result === 'object' ? result as Record<string, any> : {};
    const data = record.data && typeof record.data === 'object' ? record.data as Record<string, any> : {};
    return String(data.declaredDesignTaskTypeId || '').trim();
}

/**
 * P1 影子隔离读取：declareDesignIntent 工具把模型声明写在独立影子字段 data.shadowDeclaredDesignTaskTypeId
 * （刻意不写 data.declaredDesignTaskTypeId）——本 helper 与 readDeclaredDesignTaskTypeIdFromToolResult 物理
 * 分离，保证模型声明只进影子对比、绝不经 bindDeclaredDisciplineContextFromToolResult 触发真实激活。
 */
function readShadowDeclaredDesignTaskTypeIdFromToolResult(result: unknown): string {
    const record = result && typeof result === 'object' ? result as Record<string, any> : {};
    const data = record.data && typeof record.data === 'object' ? record.data as Record<string, any> : {};
    return String(data.shadowDeclaredDesignTaskTypeId || '').trim();
}

/**
 * 解析当前自主任务的「通用设计纪律上下文」（A1.2 通用守卫激活口径）。
 * 创意意图由控制面信号决定（isAutonomousCreativeDesignTask，不重造意图正则），
 * 声明式任务类型 id 由结构化通道提供（declaredTaskType 参数 / 控制面信号数据映射），
 * 参考来源只供显式 reference-first policy 使用；团队、交互及其它能力始终由 Planner
 * 从 Capability Registry 自主选择，不再通过品类布尔开关隐藏。
 */
function resolveAutonomousDesignDisciplineContext(
    params?: Record<string, any>,
    context?: any
): DesignDisciplineContext {
    return resolveDesignDisciplineContext({
        taskText: getAutonomousTaskText(params, context),
        isCreativeDesignIntent: isAutonomousCreativeDesignTask(params, context),
        declaredTaskTypeId: resolveDeclaredDesignTaskTypeIdForAutonomousRun(params),
        hasReferenceSource: hasExplicitDesignReferenceSource(params, context),
        activeDocumentName: resolveCurrentPhotoshopDocumentName(context)
    });
}

function resolveDesignerAgentScenario(
    params?: Record<string, any>,
    context?: any
): DesignAgentOsScenario {
    const userTask = getAutonomousTaskText(params, context);
    const skillId = String(params?.skillId || '').trim();
    const declaredTaskTypeId = resolveDeclaredDesignTaskTypeIdForAutonomousRun(params);
    const declaredTaskTypeSpec = getDesignTaskTypeSpec(declaredTaskTypeId)
        || getDesignTaskTypeSpecBySkillId(skillId);
    if (declaredTaskTypeSpec) return declaredTaskTypeSpec.runtimeHints.scenario;
    if (hasExplicitDesignReferenceSource(params, context)) {
        return resolveReferenceReplicationDeliveryScenario(
            resolveReferenceReplicationOutputIntent({ userIntent: userTask })
        );
    }
    const taskTypeSpec = resolveDesignTaskTypeSpec(userTask);
    if (taskTypeSpec) return taskTypeSpec.runtimeHints.scenario;
    if (/模板|template/i.test(userTask)) return 'template';
    if (/文案|标题|配文|卖点/.test(userTask)) return 'copywriting';
    if (isAutonomousCreativeDesignTask(params, context)) return 'general-design';
    return 'unknown';
}

function shouldUseDesignerAgentDecisionLayer(
    params?: Record<string, any>,
    context?: any
): boolean {
    if (params?.requiresDesignerAgentDecision === true) return true;
    if (isAutonomousCreativeDesignTask(params, context)) return true;
    const scenario = resolveDesignerAgentScenario(params, context);
    return scenario !== 'unknown';
}

function extractDesignerAgentDecision(params?: Record<string, any>): any {
    const candidates = [
        params?.designIntelligenceDecision,
        params?.designAgentDecision,
        params?.agentDesignDecision
    ];
    return candidates.find((item) => item && typeof item === 'object' && !Array.isArray(item)) || null;
}

function buildDesignerAgentDecisionInput(
    params?: Record<string, any>,
    context?: any
) {
    return {
        userTask: getAutonomousTaskText(params, context),
        scenario: resolveDesignerAgentScenario(params, context),
        visualInsightCache: context?.projectContext?.visualInsightCache,
        agentDecision: extractDesignerAgentDecision(params)
    };
}

function buildDesignerAgentTeamConsultationInput(
    params?: Record<string, any>,
    context?: any,
    decisionStatus?: ReturnType<typeof buildDesignerAgentDecisionContract>['status']
) {
    const userTask = getAutonomousTaskText(params, context);
    const controlPlane = params?.agentIntentControlPlane;
    const explicitTeamSignal = isCompleteAgentIntentControlPlaneDecision(controlPlane)
        && controlPlane.matchedSignals.includes('explicit_team_pipeline');
    return {
        userTask,
        scenario: resolveDesignerAgentScenario(params, context),
        decisionStatus,
        hasCurrentDocument: resolveCurrentPhotoshopDocumentPresence(context) === true,
        explicitTeamRequest: params?.requiresDesignTeamConsultation === true || explicitTeamSignal
    };
}

function isCompleteAgentIntentControlPlaneDecision(
    value: unknown
): value is AgentIntentControlPlaneDecision {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Partial<AgentIntentControlPlaneDecision>;
    return record.version === 'agent-intent-control-plane/v0'
        && typeof record.requestKind === 'string'
        && typeof record.toolScope === 'string'
        && typeof record.shouldUseConversationalPath === 'boolean'
        && typeof record.allowsDeterministicRoute === 'boolean'
        && typeof record.allowsRouterModel === 'boolean'
        && typeof record.allowsAutonomousExecution === 'boolean'
        && typeof record.requiresClarificationBeforeTools === 'boolean'
        && typeof record.executionAuthorization === 'string'
        && typeof record.reason === 'string'
        && typeof record.userVisibleSummary === 'string'
        && Array.isArray(record.matchedSignals);
}

function completeAutonomousAgentIntentControlPlane(
    params: Record<string, any> = {},
    context?: any,
    userTask = ''
): AgentIntentControlPlaneDecision {
    const provided = params.agentIntentControlPlane;
    if (isCompleteAgentIntentControlPlaneDecision(provided)) {
        return {
            ...provided,
            matchedSignals: [...provided.matchedSignals]
        };
    }
    const fallback = buildAgentIntentControlPlaneDecision({
        userInput: userTask || getAutonomousTaskText(params, context),
        hasImageInput: Array.isArray(params.images) && params.images.length > 0,
        hasDocument: resolveCurrentPhotoshopDocumentPresence(context),
        photoshopConnected: resolveCurrentPhotoshopConnection(context)
    });
    if (!provided || typeof provided !== 'object' || Array.isArray(provided)) {
        return fallback;
    }

    const record = provided as Partial<AgentIntentControlPlaneDecision>;
    return {
        ...fallback,
        ...record,
        version: 'agent-intent-control-plane/v0',
        requestKind: record.requestKind || fallback.requestKind,
        toolScope: record.toolScope || fallback.toolScope,
        shouldUseConversationalPath: record.shouldUseConversationalPath ?? fallback.shouldUseConversationalPath,
        allowsDeterministicRoute: record.allowsDeterministicRoute ?? fallback.allowsDeterministicRoute,
        allowsRouterModel: record.allowsRouterModel ?? fallback.allowsRouterModel,
        allowsAutonomousExecution: record.allowsAutonomousExecution ?? fallback.allowsAutonomousExecution,
        requiresClarificationBeforeTools: record.requiresClarificationBeforeTools ?? fallback.requiresClarificationBeforeTools,
        executionAuthorization: record.executionAuthorization || fallback.executionAuthorization,
        reason: record.reason || fallback.reason,
        userVisibleSummary: record.userVisibleSummary || fallback.userVisibleSummary,
        matchedSignals: Array.from(new Set([
            ...(fallback.matchedSignals || []),
            ...(record.matchedSignals || [])
        ]))
    };
}

function hasExplicitDesignReferenceSource(params?: Record<string, any>, context?: any): boolean {
    const userTask = getAutonomousTaskText(params, context);
    return /https?:\/\/|www\.|参考链接|参考这个|参考页面|按.*(?:链接|网址|页面)|复刻|对标/.test(userTask);
}

function normalizePhotoshopBridgeReadiness(value: unknown): PhotoshopBridgeReadiness | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, any>;
    if (typeof record.ready !== 'boolean') return null;

    return {
        ready: record.ready,
        healthStatus: typeof record.healthStatus === 'string'
            ? record.healthStatus as PhotoshopBridgeReadiness['healthStatus']
            : (record.ready ? 'ready' : 'photoshop_bridge_unresponsive'),
        blockers: Array.isArray(record.blockers)
            ? record.blockers.map((item) => String(item || '').trim()).filter(Boolean)
            : [],
        recoveryActions: Array.isArray(record.recoveryActions)
            ? record.recoveryActions.map((item) => String(item || '').trim()).filter(Boolean)
            : [],
        source: record.source === 'mcp-host' || record.source === 'ipc' || record.source === 'provided'
            ? record.source
            : 'provided'
    };
}

function shouldRequirePhotoshopBridgeReadinessForAutonomousAgent(
    params?: Record<string, any>,
    context?: any
): boolean {
    const controlPlane = params?.agentIntentControlPlane;
    if (
        controlPlane?.requestKind === 'autonomous_execution'
        && controlPlane?.toolScope === 'write_photoshop'
    ) {
        return true;
    }
    // 任何从零设计纪律任务（详情页 / 主图 / SKU 模板）都要落地 Photoshop，需先确认桥已就绪。
    return resolveAutonomousDesignDisciplineContext(params, context).active;
}

async function resolvePhotoshopBridgeReadinessForAutonomousAgent(
    params?: Record<string, any>,
    context?: any
): Promise<PhotoshopBridgeReadiness | null> {
    const provided = normalizePhotoshopBridgeReadiness(params?.photoshopBridgeReadiness);
    if (provided) return provided;

    if (resolveCurrentPhotoshopConnection(context) === false) {
        return {
            ready: false,
            healthStatus: 'photoshop_not_connected',
            blockers: ['Photoshop 还没有连接。'],
            recoveryActions: ['请先打开 Photoshop，并确认插件已经连接。'],
            source: 'provided'
        };
    }

    return checkPhotoshopBridgeReadiness();
}

function buildPhotoshopBridgeNotReadyResult(readiness: PhotoshopBridgeReadiness): AgentResult {
    const recoveryActions = readiness.recoveryActions.length > 0
        ? readiness.recoveryActions
        : [
            '请在 UXP Developer Tool 中重载插件。',
            '如果仍无响应，请重新打开 Photoshop。'
        ];

    return {
        success: false,
        message: `Photoshop 暂时无法处理这次设计任务。${recoveryActions.join('')}`,
        error: 'photoshop_bridge_not_ready',
        data: {
            photoshopBridgeReadiness: readiness
        }
    };
}

function resolveAutonomousPerformancePolicy(
    params: Record<string, any>,
    context: any,
    designDisciplineContext: DesignDisciplineContext,
    runtimeContractBundle?: AgentTaskRuntimeContractBundle
): AgentPerformancePolicy | undefined {
    if (!designDisciplineContext.active && !runtimeContractBundle) return undefined;
    const projectContext = context?.projectContext || {};
    const projectImageCount = Number(
        projectContext.projectImageCount
        || projectContext.assetIndex?.summary?.totalImages
        || 0
    );
    const visualSamplingCandidateCount = Number(
        projectContext.visualSamplingCandidateCount
        || projectContext.visualSamplingPlan?.selectedCandidates?.length
        || 0
    );
    const performanceSkillId = runtimeContractBundle?.methodManifests[0]?.skill_id
        || runtimeContractBundle?.artifactManifest?.skill_id
        || runtimeContractBundle?.manifest.skill_id
        || 'autonomous-agent';
    const performanceTaskType = runtimeContractBundle?.artifactManifest?.task_type
        || runtimeContractBundle?.manifest.task_type
        || designDisciplineContext.taskTypeId;
    return buildAgentPerformancePolicy({
        userText: getAutonomousTaskText(params, context),
        scenario: designDisciplineContext.spec?.runtimeHints.scenario
            || resolveDesignerAgentScenario(params, context),
        action: 'create',
        skillId: performanceSkillId,
        taskType: performanceTaskType,
        workMode: runtimeContractBundle?.stagePlan.expectedWorkMode,
        requiresPhotoshop: true,
        projectImageCount: Number.isFinite(projectImageCount) ? projectImageCount : 0,
        visualSamplingCandidateCount: Number.isFinite(visualSamplingCandidateCount) ? visualSamplingCandidateCount : 0
    });
}

function buildBaseSystemPrompt(params: Record<string, any>, context?: any): string {
    const lines: string[] = [
        buildAgentOperatingProfilePromptSection(),
        '从视觉层级、构图、产品真实性、排版、色彩、可读性和转化目标出发思考与表达，不要把工程执行过程当成设计判断。',
        '所有用户可见内容与 provider-visible reasoning_content 必须使用简洁的简体中文（Simplified Chinese）。',
        '不要叙述 Harness（Do not narrate Harness）、Runtime、系统提示、能力装载、工具名、路由、门禁、轮次或调试过程。受阻时，只说明缺少哪项设计信息或观察结果、会影响什么判断，以及安全的下一步。',
        '理解用户目标后，根据当前上下文和已完成的观察选择最短可行路径，不要强迫所有任务经过同一套固定流程。',
        '模型负责理解、设计策略与动态计划；Runtime 负责能力激活、权限、执行、阶段状态、工具结果、运行记录和完成检查。',
        '只使用当前阶段已经开放的能力；能力可用不等于获得执行权限。',
        '优先确定性、非破坏性操作，不得臆造文档状态或项目文件。',
        '需要真实处理时，从当前开放能力中选择；用户只是在交流时，直接用自然、简洁的中文回答。',
        '开始实际处理前，只用一句设计语言说明要实现的画面效果和首先要确认的视觉要点；不要列能力、工具、门禁或技术步骤。',
        '用户可见的过程只保留有价值的设计判断，例如主体比例、构图、留白、文字层级和色彩关系；完成必要的结果检查前不得宣称完成。',
        '最终回复用简洁中文说明完成了什么、画面结果如何；如未完成，说明视觉影响和下一步，不输出工程诊断。',
        AGENT_RESPONSE_PRESENTATION_PROMPT
    ];
    return lines.join('\n');
}

function buildBaseCapabilityPolicyPrompt(params: Record<string, any>, context?: any): string {
    return [
        'Choose registered Skills, collaboration capabilities and atomic Tools from their current declarations; do not infer a fixed role sequence or fixed business workflow from this policy.',
        'For actionable work, inspect only the project or Photoshop context needed for the current decision. State-changing work requires current authorization and later readback.',
        'If information needed for the next decision is observable through currently exposed read-only capabilities, inspect it before asking the user. Layer names, text content, layout, current visual context and project resources are environment facts; ask only after the relevant observation is unavailable, fails, stays ambiguous, or the missing choice would materially change the result.',
        'When a referenced project resource is unresolved, use currently exposed resource discovery capabilities before asking for a path; ambiguity or unsafe candidates require clarification.',
        'After a state change, prefer structural readback first and request visual inspection only when the quality question requires it.',
        'Before any Photoshop write call: (1) read the target document first with a read tool that returns the document identity, and use only layerIds returned by earlier tool results — never guess ids; (2) write one user-visible Chinese sentence of design rationale (what will change and why, ≥12 chars, containing wording like 计划/准备/确认/检查/复核/修改/创建/生成) in the same response as the write call — reasoning hidden in the thinking block does not count; (3) state how the result will be checked afterwards, using wording like 验证/复核/确认/回读/截图/结果. Missing any of these blocks the batch and wastes a round.',
        'The user-visible thinking panel is a concise design progress summary, not an operation log. Summarize one meaningful design judgment per phase; do not narrate every search query, coordinate calculation, layer action or tool name.',
        'Photoshop Tool semantics for the currently exposed capability surface:',
        buildPhotoshopToolSemanticsSummary('text'),
        'Text-field readback can prove structured content and style fields, but cannot by itself prove screenshot-level typography quality or reference fidelity.',
        buildDesignerAgentAutonomyPrinciplesPromptSection({
            hasPhotoshopDocument: resolveCurrentPhotoshopDocumentPresence(context)
        })
    ].filter(Boolean).join('\n');
}

function buildBaseRuntimeContext(params: Record<string, any>, context?: any): string {
    const lines: string[] = [];
    const selectedSkillHandoff = validateRuntimeSelectedSkillHandoff(params.runtimeSelectedSkillHandoff)
        ? params.runtimeSelectedSkillHandoff
        : undefined;
    const recognizedSkillParams = params.skillParams && typeof params.skillParams === 'object'
        ? JSON.stringify(params.skillParams)
        : '';
    const designDocumentRoleContext = buildDesignDocumentRoleContext({
        userInput: getAutonomousTaskText(params, context),
        currentDocumentName: resolveCurrentPhotoshopDocumentName(context),
        workMode: normalizeRuntimeDesignWorkMode(params?.declaredWorkMode)
    });
    if (params.skillId || params.intentMode || recognizedSkillParams) {
        lines.push(
            'Recognized intent context:',
            `- Suggested skill: ${params.skillId || 'none'}`,
            `- Suggested mode: ${params.intentMode || 'none'}`,
            `- Extracted constraints: ${recognizedSkillParams || 'none'}`
        );
    }
    if (selectedSkillHandoff) {
        lines.push(
            '已选专业 Skill：',
            `- 交付物负责人：${selectedSkillHandoff.skillId}`,
            '- 当前 Skill 已拥有这项交付物的方法。若同名工作流动作已开放，优先调用它并传入用户约束，不要先用原子 Photoshop 工具重新手工拼一遍。',
            '- 只有该 Skill 明确不可用或受阻、返回后续调整移交，或者下一步超出 Skill 结果时，才使用原子工具继续。'
        );
    }
    if (designDocumentRoleContext.targetRole !== 'unknown' || designDocumentRoleContext.currentRole !== 'unknown') {
        lines.push(
            'Design document role context:',
            `- Target role: ${designDocumentRoleContext.targetRole}`,
            `- Current document role: ${designDocumentRoleContext.currentRole}`,
            `- Current document use: ${designDocumentRoleContext.currentDocumentUse}`,
            `- Can reuse current document: ${designDocumentRoleContext.canReuseCurrentDocument ? 'yes' : 'no'}`,
            designDocumentRoleContext.agentInstruction
        );
    }
    return lines.join('\n');
}

export interface AutonomousCapabilityRuntime {
    runtimeContractBundle?: AgentTaskRuntimeContractBundle;
    capabilitySession: AgentCapabilitySession;
    runtimeContractStatus: RuntimeContractStatus;
}

export function resolveAutonomousCapabilityRuntime(
    params: Record<string, any>,
    context?: any
): AutonomousCapabilityRuntime {
    const atomicTools = getDefaultAgentTools();
    const workflowBridgeTools = buildSkillToolSchemas();
    const candidateTools = [
        ...atomicTools,
        DELEGATE_TOOL,
        TEAM_PIPELINE_TOOL,
        ...workflowBridgeTools
    ];
    // Capability 选择只采信真正的结构化声明。设计纪律仍可在 Policy 层读取旧任务文本，
    // 但其正则迁移逻辑不得回流到 Resolver，否则自然语言会再次形成品类 manifest 牢笼。
    const rawHandoff = params?.runtimeSelectedSkillHandoff;
    const runtimeSelectedSkillHandoff: RuntimeSelectedSkillHandoff | undefined = (
        validateRuntimeSelectedSkillHandoff(rawHandoff) ? rawHandoff : undefined
    );
    const structuredTaskType = String(params?.declaredTaskType || '').trim() || undefined;
    const structuredWorkModeText = String(params?.declaredWorkMode || '').trim();
    const structuredWorkMode = normalizeRuntimeDesignWorkMode(structuredWorkModeText);
    const structuredWorkModeInvalid = Boolean(structuredWorkModeText && !structuredWorkMode);
    const explicitStructuredSkillId = String(params?.declaredSkillId || '').trim() || undefined;
    const handoffInvalid = rawHandoff !== undefined && !runtimeSelectedSkillHandoff;
    const handoffConflictsWithDeclaration = Boolean(
        runtimeSelectedSkillHandoff
        && explicitStructuredSkillId
        && runtimeSelectedSkillHandoff.skillId !== explicitStructuredSkillId
    );
    const structuredSkillId = runtimeSelectedSkillHandoff?.skillId
        || explicitStructuredSkillId
        || undefined;
    const runtimeContractBundle = handoffInvalid || handoffConflictsWithDeclaration || structuredWorkModeInvalid
        ? undefined
        : buildRuntimeContractBundleForAgentTask({
            taskType: structuredTaskType,
            skillId: structuredSkillId,
            ...(structuredWorkMode ? { workMode: structuredWorkMode } : {}),
            executableToolNames: candidateTools.map((tool) => tool.name)
        });
    const runtimeContractStatus = buildRuntimeContractStatus({
        selectedSkillId: structuredSkillId,
        selectedTaskType: structuredTaskType,
        manifestSkillId: runtimeContractBundle?.manifest.skill_id,
        selectionSource: runtimeSelectedSkillHandoff?.source || (
            structuredSkillId || structuredTaskType ? 'explicit_runtime_declaration' : undefined
        ),
        selectionExpected: rawHandoff !== undefined || Boolean(structuredSkillId || structuredTaskType)
    });
    const capabilitySession = createAgentCapabilitySession({
        candidateTools,
        workflowBridgeNames: workflowBridgeTools.map((tool) => tool.name),
        requestedTaskType: structuredTaskType,
        manifest: runtimeContractBundle?.manifest
    });

    return {
        ...(runtimeContractBundle ? { runtimeContractBundle } : {}),
        capabilitySession,
        runtimeContractStatus
    };
}

export function selectToolsForContext(params: Record<string, any>, context?: any): ToolSchema[] {
    return resolveAutonomousCapabilityRuntime(params, context).capabilitySession.activeTools;
}

function buildPrimaryAgentDispatchPlan(taskType: ConversationTaskType = 'logic', explicitModelId?: string) {
    try {
        const state = useAppStore.getState();
        const prefs = (state as any).modelPreferences;
        return buildMultimodalModelDispatchPlan({
            consumer: 'primary-agent',
            taskType,
            prefs,
            mode: prefs?.mode,
            includeFallback: prefs?.autoFallback,
            includeCrossTaskBackups: true,
            requireToolUse: true,
            explicitModelId,
            availableModels: FALLBACK_MODELS
        });
    } catch {
        return buildMultimodalModelDispatchPlan({
            consumer: 'primary-agent',
            taskType,
            explicitModelId: explicitModelId || FALLBACK_MODELS[0],
            availableModels: FALLBACK_MODELS,
            requireToolUse: true
        });
    }
}

/**
 * 读取模型偏好（store 读取失败时返回 undefined，由调用方按「无配置」诚实处理，不静默兜底）。
 */
function readModelPreferencesSafe(): any {
    try {
        return (useAppStore.getState() as any).modelPreferences;
    } catch {
        return undefined;
    }
}

function isAutoFallbackEnabled(): boolean {
    return readModelPreferencesSafe()?.autoFallback === true;
}

function findConfiguredModelInRendererState(modelId: string): ModelConfig | null {
    const knownModel = getModelById(modelId);
    if (knownModel) return knownModel;

    const dynamicModels = (useAppStore.getState() as any).dynamicModels;
    if (!Array.isArray(dynamicModels)) return null;
    return dynamicModels.find((model: ModelConfig) => model?.id === modelId) || null;
}

/**
 * 从用户配置的双角色模型中读取本轮模型。
 * 直接读取 primaryModel / visualModel，避免自主执行链再次经过旧任务槽映射后与普通对话链产生分歧；
 * 同时仍用真实模型配置拒绝图片生成等非对话模型，未知模型不会被乐观放行。
 */
function resolveUserConfiguredPrimaryModel(taskType: ConversationTaskType): string {
    try {
        const prefs = readModelPreferencesSafe();
        const modelId = String(taskType === 'visual' ? prefs?.visualModel : prefs?.primaryModel || '').trim();
        if (!modelId) return '';

        const model = findConfiguredModelInRendererState(modelId);
        if (!model || !isConversationModelConfig(model)) return '';
        if (taskType === 'visual' && model.supportsVision !== true) return '';
        if (taskType !== 'visual' && model.supportsToolUse === false) return '';
        return modelId;
    } catch {
        return '';
    }
}

/**
 * 主 Agent 实际使用的模型 id 解析（单一不变量）：
 * - dispatch 已解析出已识别模型 → 直接用；
 * - 否则 autoFallback=true → 允许降级到 FALLBACK_MODELS[0]（保留 tier 降级，行为不变）；
 * - autoFallback=false → 只用用户配置的原始模型，解析不出则返回 ''（由上层诚实失败，不静默落 google）。
 */
function resolvePrimaryAgentModelId(
    dispatchPlan: ReturnType<typeof buildPrimaryAgentDispatchPlan>,
    taskType: ConversationTaskType,
    autoFallbackEnabled: boolean
): string {
    if (dispatchPlan.selectedModelId) return dispatchPlan.selectedModelId;
    if (autoFallbackEnabled) return FALLBACK_MODELS[0];
    return resolveUserConfiguredPrimaryModel(taskType);
}

function getModelId(taskType: ConversationTaskType = 'logic'): string {
    const dispatchPlan = buildPrimaryAgentDispatchPlan(taskType);
    return resolvePrimaryAgentModelId(dispatchPlan, taskType, isAutoFallbackEnabled());
}

/**
 * 没有可用角色模型时，内部保留稳定错误码，用户只看到自然、可行动的说明。
 * 不向设计用户暴露任务槽、路由、候选队列或自动降级实现。
 */
function buildNoUsableModelResult(taskType: ConversationTaskType, autoFallbackEnabled: boolean): AgentResult {
    const modelRole = taskType === 'visual' ? '视觉模型' : '主模型';
    const fallbackBoundary = autoFallbackEnabled
        ? ''
        : '我没有擅自改用其他模型。';
    return {
        success: false,
        message: `这次暂时没能连接到你选择的${modelRole}，所以还没有开始处理画面。${fallbackBoundary}请在模型设置中检查${modelRole}和对应的 API Key 后再试。`,
        error: `no_usable_model:${taskType}:autoFallback=${autoFallbackEnabled}`
    };
}

/**
 * 工具循环思考开关：按用户「模型思考」偏好 + 模型能力（isModelThinkingUserControllable）解析
 * 当前主模型是否开启原生思考。与对话通道共用 resolveModelThinkingEnabledForCall，保证两条通道一致。
 */
function resolveAgentThinkingEnabled(modelId: string): boolean {
    try {
        const prefs = (useAppStore.getState() as any).modelPreferences;
        return resolveModelThinkingEnabledForCall(modelId, prefs);
    } catch {
        return false;
    }
}

function resolveVisualExpertModelId(): string {
    return resolveUserConfiguredPrimaryModel('visual');
}

function createRuntimeSessionNonce(): string {
    const strongNonce = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : Math.random().toString(36).slice(2, 14);
    return `runtime-${Date.now().toString(36)}-${strongNonce || 'fallback'}`;
}

function readRuntimeSessionFromAgentResult(result: unknown): RuntimeSession | undefined {
    const session = (result as { data?: { runtimeSession?: unknown } } | null)?.data?.runtimeSession;
    if (!session || typeof session !== 'object') return undefined;
    const value = session as Partial<RuntimeSession>;
    if (value.version !== 'runtime-session/v0'
        || !value.identity
        || !value.stageState
        || !value.stageTrace
        || value.finalized !== true) {
        return undefined;
    }
    return value as RuntimeSession;
}

function readRuntimePlanningDeclarationsFromAgentResult(
    result: unknown
): RuntimePlanningDeclarations {
    const data = (result as { data?: Record<string, unknown> } | null)?.data;
    return {
        ...(data?.runtimeDesignBriefDeclaration && typeof data.runtimeDesignBriefDeclaration === 'object'
            ? { brief: data.runtimeDesignBriefDeclaration as RuntimePlanningDeclarations['brief'] }
            : {}),
        ...(data?.runtimeReferenceBriefDeclaration && typeof data.runtimeReferenceBriefDeclaration === 'object'
            ? { referenceBrief: data.runtimeReferenceBriefDeclaration as RuntimePlanningDeclarations['referenceBrief'] }
            : {}),
        ...(data?.runtimeDesignStrategyDeclaration && typeof data.runtimeDesignStrategyDeclaration === 'object'
            ? { strategy: data.runtimeDesignStrategyDeclaration as RuntimePlanningDeclarations['strategy'] }
            : {}),
        ...(data?.runtimeActionPlanDeclaration && typeof data.runtimeActionPlanDeclaration === 'object'
            ? { actionPlan: data.runtimeActionPlanDeclaration as RuntimePlanningDeclarations['actionPlan'] }
            : {})
    };
}

async function finalizeRuntimeArtifactsForProject(input: {
    projectPath?: string;
    publication: RuntimeArtifactPublicationInput;
    authorizationTokens: Map<string, string>;
}): Promise<ArtifactRepositoryReadProjection | undefined> {
    const projectPath = String(input.projectPath || '').trim();
    const finalizeBridge = window.designEcho?.finalizeRuntimeArtifacts;
    if (!projectPath || typeof finalizeBridge !== 'function') {
        return undefined;
    }
    const session = input.publication.runtimeSession;
    const authorizationToken = input.authorizationTokens.get(session.identity.runId);
    if (!authorizationToken) return undefined;
    const request: RuntimeArtifactFinalizationRequest = {
        version: RUNTIME_ARTIFACT_FINALIZATION_VERSION,
        authorizationToken,
        artifacts: {
            ...(input.publication.runtimeDesignBriefDeclaration
                ? { runtimeDesignBrief: input.publication.runtimeDesignBriefDeclaration }
                : {}),
            ...(input.publication.runtimeDesignStrategyDeclaration
                ? { runtimeDesignStrategy: input.publication.runtimeDesignStrategyDeclaration }
                : {}),
            ...(input.publication.runtimeActionPlanDeclaration
                ? { runtimeActionPlan: input.publication.runtimeActionPlanDeclaration }
                : {}),
            ...(input.publication.designVerdict
                ? { evaluationReport: input.publication.designVerdict }
                : {}),
            ...(input.publication.runtimeDeliveryVerification
                ? { runtimeDeliveryVerification: input.publication.runtimeDeliveryVerification }
                : {})
        }
    };
    if (Object.keys(request.artifacts).length === 0) return undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await finalizeBridge(projectPath, request);
            if (response?.success === true) {
                input.authorizationTokens.delete(session.identity.runId);
                return readArtifactRepositoryProjection(response.projection);
            }
            const code = String(response?.code || '');
            const retryable = !code.startsWith('authorization_') && code !== 'invalid_finalization';
            if (attempt === 0 && retryable) continue;
            console.warn(`[ArtifactRepository] Runtime 收尾发布失败：${response?.error || '未知原因'}`);
            return undefined;
        } catch (error: any) {
            if (attempt === 0) continue;
            console.warn(`[ArtifactRepository] Runtime 收尾发布异常：${error?.message || String(error)}`);
            return undefined;
        }
    }
    return undefined;
}

async function authorizeRuntimeArtifactFinalizationForProject(input: {
    projectPath?: string;
    requestId: string;
    skillId: string;
    taskType: string;
    previousRunId?: string;
}): Promise<RuntimeArtifactAuthorizationGrant | undefined> {
    const projectPath = String(input.projectPath || '').trim();
    const authorizationBridge = window.designEcho?.authorizeRuntimeArtifactFinalization;
    if (!projectPath || typeof authorizationBridge !== 'function') return undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await authorizationBridge(projectPath, {
                version: RUNTIME_ARTIFACT_AUTHORIZATION_REQUEST_VERSION,
                requestId: input.requestId,
                skillId: input.skillId,
                taskType: input.taskType,
                ...(input.previousRunId ? { previousRunId: input.previousRunId } : {})
            });
            if (response?.success !== true) {
                console.warn(`[ArtifactRepository] Runtime 收尾授权失败：${response?.error || '未知原因'}`);
                return undefined;
            }
            const grant = readRuntimeArtifactAuthorizationGrant(response.grant);
            if (!grant || grant.skillId !== input.skillId || grant.taskType !== input.taskType) {
                console.warn('[ArtifactRepository] Runtime 收尾授权响应非法，已禁用本轮 Artifact 发布。');
                return undefined;
            }
            return grant;
        } catch (error: any) {
            if (attempt === 0) continue;
            console.warn(`[ArtifactRepository] Runtime 收尾授权异常：${error?.message || String(error)}`);
            return undefined;
        }
    }
    return undefined;
}

/**
 * Harness v1 · H1：把一轮自主运行持久化为 Run Record（<project>/.designecho/runs/）。
 * 同步组装（纯逻辑摘要化，无原始载荷）、异步落盘 fire-and-forget——记录失败只
 * console.warn 具体原因，绝不影响任务结果（boundaries.neverBlocksTaskResult）。
 * 返回 runId 供 reflexion 轮间 parentRunId 链接与结果里的 runRecordRef。
 */
function persistAgentRunRecordSafely(input: {
    result: {
        success?: unknown;
        cancelled?: unknown;
        iterations?: unknown;
        stopReason?: unknown;
        toolCallLog?: Array<{ name?: unknown; arguments?: unknown; result?: unknown }>;
        executionSummary?: unknown;
    };
    userTask: string;
    controlPlane?: { requestKind?: unknown; route?: unknown; skillId?: unknown } | null;
    projectPath?: string;
    projectState?: unknown;
    parentRunId?: string;
    resumeFreshness?: RuntimeActionPlanResumeFreshness;
    runtimeSessionIdentity?: RuntimeSessionIdentity;
}): string | undefined {
    try {
        const record = buildAgentRunRecord({
            now: new Date().toISOString(),
            goal: input.userTask,
            projectPath: input.projectPath,
            projectState: input.projectState,
            parentRunId: input.parentRunId,
            resumeFreshness: input.resumeFreshness,
            runtimeSessionIdentity: input.runtimeSessionIdentity,
            controlPlane: input.controlPlane || null,
            result: input.result as any
        });
        const bridge = (window as any)?.designEcho?.writeAgentRunRecord;
        if (typeof bridge !== 'function') {
            // 旧 preload（未重启加载新桥）：记录不落盘，诚实提示一次即可
            console.warn('[RunRecord] preload 未提供 writeAgentRunRecord（应用需重启加载新桥），本轮运行记录未持久化');
            return record.runId;
        }
        if (!input.projectPath) {
            // 无项目的运行不持久化（记录归属项目目录）；不告警刷屏
            return record.runId;
        }
        Promise.resolve(bridge(record, input.projectPath)).then((outcome: any) => {
            if (!outcome || outcome.success !== true) {
                console.warn(`[RunRecord] 运行记录写入失败：${outcome?.error || '未知原因'}`);
            }
        }).catch((error: any) => {
            console.warn(`[RunRecord] 运行记录写入异常：${error?.message || String(error)}`);
        });
        return record.runId;
    } catch (error: any) {
        console.warn(`[RunRecord] 运行记录组装失败（不影响任务结果）：${error?.message || String(error)}`);
        return undefined;
    }
}

/**
 * V0-4 重入纪律播种（纯读、无副作用）：从上一轮运行结果派生确定性纪律旗标。
 * 复用 run-record 的 checkpoint 口径（buildAgentRunRecord 无 IPC/FS），只取
 * documentCreated/layoutRendered——这两个事实已被上一轮工具日志确证，回灌给下一轮纪律状态机，
 * 避免重入把已建画布/已排版当成「从零」而在存量画布旁另建空文档。
 * 两个旗标都为 false（首轮式空结果 / 派生异常）时返回 undefined：不播种、回退现状全 false，绝不抛错。
 */
function deriveReflexionDisciplineSeed(result: unknown): Partial<DesignDisciplineState> | undefined {
    try {
        const checkpoint = buildAgentRunRecord({
            now: '',
            goal: '',
            result: (result || {}) as any
        }).checkpoint;
        if (!checkpoint.documentCreated && !checkpoint.layoutRendered) return undefined;
        return {
            documentCreated: checkpoint.documentCreated,
            layoutRendered: checkpoint.layoutRendered
        };
    } catch {
        return undefined;
    }
}

export const autonomousAgentExecutor: SkillExecutor = {
    skillId: 'autonomous-agent',

    async execute(executeParams: SkillExecuteParams): Promise<AgentResult> {
        const { params, callbacks, signal, context, agentTaskPlan } = executeParams;
        const userTask = params.userTask || params.task || params.userInput || '';
        const runRecordProjectPath: string | undefined = context?.projectContext?.projectPath;

        if (!userTask) {
            return {
                success: false,
                message: '未提供任务描述。',
                error: 'Missing userTask'
            };
        }

        const runtimeParams: Record<string, any> = {
            ...(params || {}),
            agentIntentControlPlane: completeAutonomousAgentIntentControlPlane(params || {}, context, String(userTask))
        };
        const dimensionSpec = normalizeDesignDimensionSpec(
            context?.designDimensionSpec || useAppStore.getState().designDimensionSpec
        );
        const userDocumentOverrides = extractUserExplicitDocumentOverrides(userTask);
        const capabilityRuntime = resolveAutonomousCapabilityRuntime(runtimeParams, context);
        const runtimeContractBundle = capabilityRuntime.runtimeContractBundle;
        const capabilitySession = capabilityRuntime.capabilitySession;
        const runtimeContractStatus = capabilityRuntime.runtimeContractStatus;

        // R0 已解析 Manifest 时，task_type 直接来自 Manifest 单一真相源，供通用设计纪律
        // 与场景预算消费；不再要求模型额外调用 declareDesignIntent 重复声明。
        if (!runtimeParams.declaredTaskType && runtimeContractBundle?.manifest.task_type) {
            runtimeParams.declaredTaskType = runtimeContractBundle.manifest.task_type;
        }
        if (!runtimeParams.declaredWorkMode && runtimeContractBundle?.stagePlan.expectedWorkMode) {
            runtimeParams.declaredWorkMode = runtimeContractBundle.stagePlan.expectedWorkMode;
        }

        // R0 fail-closed：一旦上游明确选择了 Skill / task type，就必须解析到唯一 Manifest。
        // 不能在身份丢失时静默退回 generic broad discovery，否则 R1-R5/E1-E2 治理全部绕过。
        if (runtimeContractStatus.status === 'selected_manifest_missing') {
            return {
                success: false,
                message: '当前选择的设计能力没有对应运行清单，任务已在执行前停止。',
                error: 'runtime_selected_manifest_missing',
                data: {
                    runtimeContractStatus,
                    executesModel: false,
                    executesPhotoshop: false,
                    grantsToolPermission: false
                }
            };
        }
        const runtimeArtifactAuthorizationTokens = new Map<string, string>();
        let runtimeSessionIdentity: RuntimeSessionIdentity | undefined;
        let runtimeSessionSeed: RuntimeSession | undefined;
        let runtimePlanningContextSeed: RuntimePlanningContextSeed | undefined;
        let incomingReflexionHandoff: ReflexionHandoff | undefined;

        if (shouldRequirePhotoshopBridgeReadinessForAutonomousAgent(runtimeParams, context)) {
            const readiness = await resolvePhotoshopBridgeReadinessForAutonomousAgent(runtimeParams, context);
            if (readiness && readiness.ready === false) {
                return buildPhotoshopBridgeNotReadyResult(readiness);
            }
        }

        const requestWebSearchIntent = runtimeParams.providerNativeWebSearchIntent as ChatWebSearchIntent | undefined;
        // 自主循环始终由主 Agent 模型负责；图片不再把整轮 Agent 偷换成视觉模型。
        // 视觉模型通过 visualExpertModelId 只处理用户图片、画布观察与视觉质检，再把结论交回主模型。
        const primaryTaskType: ConversationTaskType = 'logic';
        const explicitModelId = runtimeParams.modelId || (requestWebSearchIntent ? getProviderNativeWebSearchModelId() : '');
        const primaryDispatchPlan = buildPrimaryAgentDispatchPlan(primaryTaskType, explicitModelId || undefined);
        const autoFallbackEnabled = isAutoFallbackEnabled();
        const modelId = resolvePrimaryAgentModelId(primaryDispatchPlan, primaryTaskType, autoFallbackEnabled);
        if (!modelId) {
            // 保留内部错误码便于调试，但用户只看到主模型 / 视觉模型角色，不暴露旧能力槽实现。
            return buildNoUsableModelResult(primaryTaskType, autoFallbackEnabled);
        }
        const effectivePrimaryDispatchPlan = primaryDispatchPlan.selectedModelId
            ? primaryDispatchPlan
            : {
                ...primaryDispatchPlan,
                selectedModelId: modelId,
                candidateModelIds: [modelId]
            };
        const visualExpertModelId = resolveVisualExpertModelId();
        runtimeParams.canObserveAttachedImages = Boolean(
            findConfiguredModelInRendererState(modelId)?.supportsVision
            || findConfiguredModelInRendererState(visualExpertModelId)?.supportsVision
        );
        const designDisciplineContext = resolveAutonomousDesignDisciplineContext(runtimeParams, context);
        const designDisciplineActive = designDisciplineContext.active;
        const autonomousPerformancePolicy = resolveAutonomousPerformancePolicy(
            runtimeParams,
            context,
            designDisciplineContext,
            runtimeContractBundle
        );
        const runtimeBudget = buildAutonomousAgentRuntimeBudget({
            requestedMaxIterations: runtimeParams.maxIterations,
            defaultMaxIterations: autonomousPerformancePolicy?.budget.maxIterations,
            defaultSource: designDisciplineActive ? 'stage-autonomous-agent-default' : undefined
        });
        const maxIterations = autonomousPerformancePolicy
            ? Math.min(runtimeBudget.maxIterations, autonomousPerformancePolicy.budget.maxIterations)
            : runtimeBudget.maxIterations;
        const agentCallbacks: AgentCallbacks = {
            onThinking: callbacks?.onThinking,
            onStep: callbacks?.onStep,
            onTaskPlanPresentation: callbacks?.onTaskPlanPresentation,
            onSnapshotImage: callbacks?.onSnapshotImage,
            onToolStart: callbacks?.onToolStart,
            onToolComplete: callbacks?.onToolComplete,
            onProgress: callbacks?.onProgress,
            onMessage: callbacks?.onMessage,
            onIterationComplete: (iteration, max) => {
                callbacks?.onProgress?.(`处理进度 ${iteration}/${max}`, Math.round((iteration / max) * 100));
            }
        };
        const webSearchVisibility: WebSearchVisibilityState = {
            intent: requestWebSearchIntent,
            callbacks: agentCallbacks,
            started: false,
            completed: false
        };

        // 注入共享项目状态摘要（Design Project State，通用项目记忆；无状态时静默跳过）
        let designStateSummary = '';
        let designProjectStateForFreshness: unknown;
        const stateProjectPath: string | undefined = context?.projectContext?.projectPath;
        if (stateProjectPath) {
            try {
                const stateResp = await (window as any).designEcho?.getDesignState?.(stateProjectPath);
                if (stateResp?.success && stateResp.state) {
                    designProjectStateForFreshness = stateResp.state;
                    const { buildDesignProjectStateSummary } = await import('../../../shared/design-project-state');
                    designStateSummary = buildDesignProjectStateSummary(stateResp.state);
                }
            } catch (error: any) {
                console.warn(`[AutonomousAgent] 读取项目状态失败（不影响执行）：${error?.message || error}`);
            }
        }
        // 任务进度纪律（PS 连接的自主任务常驻，独立于"是否已有状态"——首轮任务恰恰没有 State，
        // 纪律负责让它被建立；任务清单是跨轮次任务真相源，续跑以它为准）。
        // 不限设计纪律品类：真机病例是「置入+剪切」图层管理任务，同样多步、同样需要任务真相源
        //（该任务曾进第二轮并重复置入——清单在场时第二轮应看到 done 项不重做）。
        let taskStateDisciplineSection = '';
        if (designDisciplineContext.active || resolveCurrentPhotoshopConnection(context) === true) {
            try {
                const { buildTaskStateDisciplineSection } = await import('../../../shared/design-project-state');
                taskStateDisciplineSection = buildTaskStateDisciplineSection();
            } catch (error: any) {
                console.warn(`[AutonomousAgent] 读取任务进度纪律失败（不影响执行）：${error?.message || error}`);
            }
        }
        // 注入已复核采纳（active）的设计经验记忆：仅创意设计任务，让"学过的"在通用主循环也用得上
        // （此前只有 main-image/detail-page/sku 三个 executor 能读到 active 记忆）。复用单一读取路径
        // buildDesignMemoryPromptSection（active-only、needs_review 已过滤、有界、供参考不照搬）。
        let designMemorySummary = '';
        if (designDisciplineContext.active) {
            try {
                const { buildDesignMemoryPromptSection } = await import('./design-planner-context');
                designMemorySummary = buildDesignMemoryPromptSection({
                    userText: userTask,
                    limit: 3,
                    context
                });
            } catch (error: any) {
                console.warn(`[AutonomousAgent] 读取设计经验记忆失败（不影响执行）：${error?.message || error}`);
            }
        }
        // 注入设计尺寸规范（用户可配置，默认预设）——尺寸知识不写死在提示词里
        const dimensionSpecSummary = summarizeDesignDimensionSpecForAgent(dimensionSpec);
        const baseSystemPrompt = buildBaseSystemPrompt(runtimeParams, context);
        const baseCapabilityPolicyPrompt = buildBaseCapabilityPolicyPrompt(runtimeParams, context);
        const designerAgentDecisionInput = buildDesignerAgentDecisionInput(runtimeParams, context);
        const designerAgentDecisionContract = shouldUseDesignerAgentDecisionLayer(runtimeParams, context)
            ? buildDesignerAgentDecisionContract(designerAgentDecisionInput)
            : null;
        const designerAgentTeamConsultationInput = designerAgentDecisionContract
            ? buildDesignerAgentTeamConsultationInput(runtimeParams, context, designerAgentDecisionContract.status)
            : null;
        const designerAgentTeamConsultationContract = designerAgentTeamConsultationInput
            ? buildDesignerAgentTeamConsultationContract(designerAgentTeamConsultationInput)
            : null;
        if (designerAgentDecisionContract) {
            agentCallbacks.onStep?.({
                kind: 'observation',
                title: '设计判断准备',
                detail: [
                    designerAgentDecisionContract.publicDesignIntent,
                    designerAgentDecisionContract.decisionOptions.length
                        ? `可选路径：${designerAgentDecisionContract.decisionOptions.slice(0, 4).map((item) => item.label).join('、')}`
                        : '',
                    ...designerAgentDecisionContract.blockers.slice(0, 2)
                ].filter(Boolean).join('\n'),
                status: designerAgentDecisionContract.status === 'ready' ? 'success' : 'running',
                percent: 4
            });
        }
        if (
            designerAgentTeamConsultationContract
            && designerAgentTeamConsultationContract.status !== 'not_required'
        ) {
            agentCallbacks.onStep?.({
                kind: 'observation',
                title: '专业团队准备',
                detail: [
                    designerAgentTeamConsultationContract.publicTeamIntent,
                    `角色：${designerAgentTeamConsultationContract.rolePlan.map((item) => item.role).join('、')}`
                ].filter(Boolean).join('\n'),
                status: designerAgentTeamConsultationContract.status === 'required' ? 'running' : 'success',
                percent: 6
            });
        }
        const designerAgentPromptSection = designerAgentDecisionContract
            ? buildDesignerAgentPromptSection(designerAgentDecisionInput)
            : '';
        const designerAgentTeamPromptSection = designerAgentTeamConsultationContract
            && designerAgentTeamConsultationContract.status !== 'not_required'
            ? designerAgentTeamConsultationContract.promptSection
            : '';
        // Harness v1 · H2：加载上一轮「未完成运行」档案摘要（替代聊天考古的状态恢复）。
        // 只在有项目且档案未过期时注入；摘要自带"先验证再续做/无关则忽略"边界，相关性交模型判断。
        // 加载失败绝不影响任务（try/catch + 空摘要照常开跑）。
        let runResumeBriefSection = '';
        let runResumeFreshness: RuntimeActionPlanResumeFreshness | undefined;
        if (runRecordProjectPath) {
            try {
                const listBridge = (window as any)?.designEcho?.listAgentRunRecords;
                if (typeof listBridge === 'function') {
                    const listed = await listBridge(runRecordProjectPath, 5);
                    const initialResumeBrief = buildRunRecordResumeBrief({
                        records: Array.isArray(listed?.records) ? listed.records : [],
                        nowMs: Date.now()
                    });
                    let resumeBrief = initialResumeBrief;
                    const candidate = initialResumeBrief.freshnessCandidate;
                    if (candidate) {
                        const probe = buildRuntimeResumeFreshnessProbeRequest(candidate.contextAnchor);
                        let probeSucceeded = false;
                        let currentAnchor = buildRuntimeResumeContextAnchor({
                            toolCallLog: [],
                            projectState: designProjectStateForFreshness
                        });
                        if (probe && classifyAgentToolExecution(probe.toolName, probe.arguments) === 'read_only_observation') {
                            let probeResult: any;
                            try {
                                probeResult = await executeToolCall(probe.toolName, probe.arguments, { signal });
                            } catch (error: any) {
                                probeResult = { success: false, error: error?.message || String(error) };
                            }
                            probeSucceeded = probeResult?.success !== false;
                            currentAnchor = buildRuntimeResumeContextAnchor({
                                toolCallLog: [{
                                    name: probe.toolName,
                                    arguments: probe.arguments,
                                    result: probeResult
                                }],
                                projectState: designProjectStateForFreshness
                            });
                        } else if (!candidate.contextAnchor?.document) {
                            // 旧记录没有强文档锚点：无需伪装执行探针，直接进入 insufficient_context。
                            probeSucceeded = true;
                        }
                        runResumeFreshness = evaluateRuntimeActionPlanResumeFreshness({
                            sourceRunId: candidate.sourceRunId,
                            previousAnchor: candidate.contextAnchor,
                            currentAnchor,
                            completedStepIds: candidate.completedStepIds,
                            completedStepDescriptors: candidate.completedStepDescriptors,
                            resumeStepIds: candidate.resumeStepIds,
                            probeSucceeded
                        });
                        resumeBrief = buildRunRecordResumeBrief({
                            records: Array.isArray(listed?.records) ? listed.records : [],
                            nowMs: Date.now(),
                            freshness: runResumeFreshness
                        });
                    }
                    if (resumeBrief.applicable && resumeBrief.brief) {
                        runResumeBriefSection = resumeBrief.brief;
                        agentCallbacks.onStep?.({
                            kind: 'observation',
                            title: runResumeFreshness?.status === 'verified'
                                ? '已核对上一轮未完成的运行档案'
                                : '上一轮运行档案需要重新核实',
                            detail: runResumeFreshness
                                ? `${resumeBrief.reason}；新鲜度：${runResumeFreshness.status}`
                                : resumeBrief.reason,
                            status: runResumeFreshness?.status === 'verified' ? 'success' : 'running',
                            source: 'skill_executor',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                    }
                }
            } catch (error: any) {
                console.warn(`[RunResume] 运行档案加载失败（不影响本次任务）：${error?.message || String(error)}`);
            }
        }

        const designMethodKnowledge = runtimeContractBundle
            ? buildDesignMethodKnowledgeContext({
                knowledgeRefs: runtimeContractBundle.manifest.knowledge_refs || [],
                manifestSkillId: runtimeContractBundle.manifest.skill_id
            })
            : undefined;
        if (designMethodKnowledge && designMethodKnowledge.issues.length > 0) {
            throw new Error(`runtime_design_method_knowledge_invalid:${designMethodKnowledge.issues.join(',')}`);
        }

        const contextItems = ([
            {
                id: 'system.base',
                kind: 'policy',
                source: 'autonomous-agent-runtime',
                trust: 'trusted_system',
                slot: 'system_policy',
                content: baseSystemPrompt,
                priority: 100,
                freshness: 'current',
                required: true
            },
            {
                id: 'policy.model-dispatch',
                kind: 'policy',
                source: 'multimodal-model-dispatch',
                trust: 'trusted_policy',
                slot: 'capability_policy',
                content: formatPrimaryAgentDispatchPromptSection(effectivePrimaryDispatchPlan),
                priority: 90,
                freshness: 'current',
                required: true
            },
            {
                id: 'policy.execution-discipline',
                kind: 'policy',
                source: 'agent-capability-governance',
                trust: 'trusted_policy',
                slot: 'capability_policy',
                content: baseCapabilityPolicyPrompt,
                priority: 95,
                freshness: 'current',
                required: true
            },
            {
                id: 'policy.task-state-discipline',
                kind: 'policy',
                source: 'design-project-state',
                trust: 'trusted_policy',
                slot: 'capability_policy',
                content: taskStateDisciplineSection,
                priority: 80,
                freshness: 'current'
            },
            {
                id: 'policy.capability-session',
                kind: 'permission_boundary',
                source: 'capability-session',
                trust: 'trusted_policy',
                slot: 'capability_policy',
                content: capabilitySession.buildPromptSection(),
                priority: 100,
                freshness: 'current',
                required: true
            },
            {
                id: 'knowledge.design-methods',
                kind: 'knowledge',
                source: 'skill-manifest-design-methods',
                trust: 'governed_knowledge',
                slot: 'knowledge_context',
                content: designMethodKnowledge?.content || '',
                priority: 90,
                freshness: 'current'
            },
            {
                id: 'context.intent-and-document',
                kind: 'goal_context',
                source: 'runtime-input-context',
                trust: 'runtime_observation',
                slot: 'runtime_context',
                content: buildBaseRuntimeContext(runtimeParams, context),
                priority: 100,
                freshness: 'current'
            },
            ...(context?.operatingContextSnapshot
                ? [{
                    ...buildOperatingContextRuntimeItem(context.operatingContextSnapshot),
                    required: true
                }]
                : []),
            {
                id: 'context.designer-decision',
                kind: 'runtime_summary',
                source: 'designer-agent-decision',
                trust: 'runtime_observation',
                slot: 'runtime_context',
                content: designerAgentPromptSection,
                priority: 80,
                freshness: 'current'
            },
            {
                id: 'context.designer-team',
                kind: 'runtime_summary',
                source: 'designer-agent-team-consultation',
                trust: 'runtime_observation',
                slot: 'runtime_context',
                content: designerAgentTeamPromptSection,
                priority: 70,
                freshness: 'current'
            },
            {
                id: 'project.dimension-spec',
                kind: 'project_state',
                source: 'design-dimension-spec',
                trust: 'governed_project',
                slot: 'project_context',
                content: dimensionSpecSummary,
                priority: 90,
                freshness: 'current'
            },
            {
                id: 'project.design-state',
                kind: 'project_state',
                source: 'design-project-state',
                trust: 'governed_project',
                slot: 'project_context',
                content: designStateSummary,
                priority: 80,
                freshness: 'current'
            },
            {
                id: 'memory.reviewed-design-experience',
                kind: 'memory',
                source: 'design-memory',
                trust: 'reviewed_memory',
                slot: 'reviewed_memory',
                content: designMemorySummary,
                priority: 60,
                freshness: 'reviewed'
            },
            {
                id: 'runtime.resume-advice',
                kind: 'runtime_summary',
                source: 'agent-run-record',
                trust: 'runtime_observation',
                slot: 'runtime_context',
                content: runResumeBriefSection,
                priority: 50,
                freshness: 'advisory'
            }
        ] as RuntimeContextItem[]).filter((item) => Boolean(item.content));
        const compiledRuntimeContext = compileRuntimeContext({ items: contextItems });
        const criticalContextIds = new Set([
            'system.base',
            'policy.model-dispatch',
            'policy.execution-discipline',
            'policy.capability-session',
            ...(context?.operatingContextSnapshot ? [OPERATING_CONTEXT_RUNTIME_ITEM_ID] : [])
        ]);
        const rejectedCriticalContextIds = compiledRuntimeContext.rejectedItemIds.filter((id) => (
            criticalContextIds.has(id)
        ));
        if (rejectedCriticalContextIds.length > 0) {
            throw new Error(`runtime_context_critical_item_rejected:${rejectedCriticalContextIds.join(',')}`);
        }

        // 所有执行前置检查通过后才向主进程领取一次性 Artifact 收尾授权，避免无模型、
        // Photoshop 未就绪或关键上下文拒绝的请求占用授权记录。
        if (runtimeContractBundle) {
            const authorization = await authorizeRuntimeArtifactFinalizationForProject({
                projectPath: runRecordProjectPath,
                requestId: createRuntimeSessionNonce(),
                skillId: runtimeContractBundle.stagePlan.skillId,
                taskType: runtimeContractBundle.stagePlan.taskType
            });
            runtimeSessionIdentity = authorization?.runtimeIdentity || createRuntimeSessionIdentity({
                now: new Date().toISOString(),
                nonce: createRuntimeSessionNonce(),
                skillId: runtimeContractBundle.stagePlan.skillId,
                taskType: runtimeContractBundle.stagePlan.taskType
            });
            if (authorization) {
                runtimeArtifactAuthorizationTokens.set(
                    authorization.runtimeIdentity.runId,
                    authorization.authorizationToken
                );
            }
        }

        const { Agent } = await import('../agent-runtime/agent');
        const createAutonomousAgent = () => new Agent(
            {
                systemPrompt: compiledRuntimeContext.prompt,
                tools: capabilitySession.activeTools,
                modelId,
                visualExpertModelId,
                thinkingEnabled: resolveAgentThinkingEnabled(modelId),
                maxIterations,
                ...(autonomousPerformancePolicy ? {
                    performanceBudget: {
                        maxModelCalls: autonomousPerformancePolicy.budget.maxModelCalls,
                        maxToolCalls: autonomousPerformancePolicy.budget.maxToolCalls,
                        maxVisionCandidates: autonomousPerformancePolicy.budget.maxVisionCandidates,
                        maxVisualAnalyses: autonomousPerformancePolicy.budget.maxVisualAnalyses,
                        maxFullResolutionImageReads: autonomousPerformancePolicy.budget.maxFullResolutionImageReads,
                        softTimeBudgetMs: autonomousPerformancePolicy.budget.softTimeBudgetMs
                    }
                } : {}),
                signal,
                ...(agentTaskPlan ? { agentTaskPlan } : {}),
                ...(runtimeContractBundle ? {
                    runtimeLoopContract: runtimeContractBundle.runtimeLoopContract,
                    runtimeStagePlan: runtimeContractBundle.stagePlan,
                    runtimeDesignBriefAvailableInputSources: buildAutonomousDesignBriefInputSources({
                        params: runtimeParams,
                        context,
                        runtimeContractBundle
                    }),
                    taskPlanPresentationScope: {
                        conversationId: String(
                            context?.conversationId
                            || context?.requestId
                            || 'conversation:none'
                        ).trim(),
                        projectId: String(
                            context?.operatingContextSnapshot?.workspace?.project?.projectId
                            || context?.projectContext?.projectId
                            || 'workspace:none'
                        ).trim()
                    },
                    ...(runtimeSessionIdentity ? { runtimeSessionIdentity } : {}),
                    ...(runtimeSessionSeed ? { runtimeSessionSeed } : {}),
                    ...(runtimePlanningContextSeed ? { runtimePlanningContextSeed } : {}),
                    toolCapabilityBridge: runtimeContractBundle.toolCapabilityBridge,
                    evaluationProfile: runtimeContractBundle.evaluationProfile,
                    getCapabilityResolution: () => capabilitySession.getResolution(),
                    getActiveCapabilityIdsForTool: (toolName) => (
                        capabilitySession.getActiveCapabilityIdsForTool(toolName)
                    ),
                    getOnDemandActivatedCapabilityIds: () => (
                        capabilitySession.getOnDemandActivatedCapabilityIds()
                    ),
                    finalizeRuntimeArtifacts: async (publication) => (
                        await finalizeRuntimeArtifactsForProject({
                            projectPath: runRecordProjectPath,
                            publication,
                            authorizationTokens: runtimeArtifactAuthorizationTokens
                        })
                    ),
                    ...(runResumeFreshness ? {
                        runtimeActionPlanResumeFreshness: runResumeFreshness
                    } : {})
                } : {}),
                ...(incomingReflexionHandoff ? { reflexionHandoff: incomingReflexionHandoff } : {}),
                taskCompletionContext: {
                    skillId: runtimeParams.skillId,
                    intentMode: runtimeParams.intentMode,
                    imageCount: Array.isArray(runtimeParams.images) ? runtimeParams.images.length : 0
                },
                toolDecisionContext: {
                    intentControlPlane: runtimeParams.agentIntentControlPlane,
                    photoshopConnected: resolveCurrentPhotoshopConnection(context),
                    hasDocument: resolveCurrentPhotoshopDocumentPresence(context),
                    hasImageInput: Array.isArray(runtimeParams.images) ? runtimeParams.images.length > 0 : false,
                    currentDocumentUse: buildDesignDocumentRoleContext({
                        userInput: userTask,
                        currentDocumentName: resolveCurrentPhotoshopDocumentName(context),
                        workMode: normalizeRuntimeDesignWorkMode(runtimeParams?.declaredWorkMode)
                    }).currentDocumentUse
                },
                callbacks: agentCallbacks,
                callModelStream: createCallModelStreamViaIPC(requestWebSearchIntent, webSearchVisibility)
            },
            createCallModelViaIPC(requestWebSearchIntent, webSearchVisibility),
            createExecuteToolWrapper(
                agentCallbacks,
                signal,
                context,
                runtimeParams,
                designerAgentTeamConsultationContract,
                capabilitySession,
                dimensionSpec,
                userDocumentOverrides
            )
        );

        try {
            let result = await createAutonomousAgent().run(userTask, runtimeParams.images);
            let accumulatedSuccessfulMutationCalls = countSuccessfulMutationCalls(result);

            // Reflexion 闭环：一轮结束、质量门禁未过且生成了下一轮约束时，带着复盘约束自动重跑。
            // 不拦截轮内任何工具调用（非门禁）；护栏（重入上限/取消/无进展即停）在 reflexion-reentry-policy。
            // 单一停机口径（用户拍板：质量返工 ≤3 轮、超限升级人工）：creative_design 有各轮评分卡时，
            // 质量停机控制器 evaluateQualityLoopDecision 与基础重入护栏取更严格者——任一说停即停；
            // 仅「质量分在涨」的轮次把重入上限从 ≤1 放宽到 ≤3（无进展仍按失败签名即停）。
            let reflexionReentryCount = 0;
            let previousReflexionFailureSignature: string | undefined;
            const designScorecardHistory: DesignScorecard[] = [];
            let qualityHaltNotice: string | undefined;
            // legacy 无 Runtime Session 时保留旧 parentRunId 链；生产 Session 的 lineage 由 identity 拥有。
            let lastRunRecordId: string | undefined;
            while (!result.cancelled) {
                if (signal?.aborted) break;
                // 停在用户确认点（交互卡片待确认）不是质量门禁失败，不能自动重跑——必须等用户确认。
                const awaitingUserConfirmation = result.stopReason === 'awaiting_user_confirmation'
                    || (result.data as Record<string, unknown> | undefined)?.awaitingUserConfirmation === true;
                if (awaitingUserConfirmation) break;
                // 收集本轮评分卡（仅 creative_design 且写后有新鲜结构读时 agent 收尾才评出；诚实缺席不补造）。
                const latestScorecard = result.executionSummary?.designScorecard;
                if (latestScorecard) designScorecardHistory.push(latestScorecard);
                const reflexionHandoff = ((result.data as Record<string, unknown> | undefined)?.reflexionHandoff
                    || result.executionSummary?.reflexionHandoff) as ReflexionHandoff | undefined;
                const reentryDecision = decideQualityAwareReflexionReentry({
                    handoff: reflexionHandoff,
                    priorReentryCount: reflexionReentryCount,
                    cancelled: false,
                    previousFailureSignature: previousReflexionFailureSignature,
                    scorecardHistory: designScorecardHistory,
                    stopReason: result.stopReason
                });
                if (!reentryDecision.shouldReenter || !reflexionHandoff) {
                    // 质量口径要求升级人工 / 达返工上限 → 诚实失败：向用户说明卡点与各轮分数轨迹，
                    // 不伪造完成（result.success 由 agent 收尾裁决决定，此处只补说明、绝不改判成功）。
                    if (reentryDecision.qualityHalt === 'escalate_human' || reentryDecision.qualityHalt === 'stop_max_rounds') {
                        qualityHaltNotice = buildQualityLoopHaltMessage({
                            qualityHalt: reentryDecision.qualityHalt,
                            reason: reentryDecision.qualityDecision?.reason || '质量返工停止条件已触发。',
                            scoreTrajectory: reentryDecision.scoreTrajectory,
                            reentryCount: reflexionReentryCount,
                            latestScorecard: designScorecardHistory[designScorecardHistory.length - 1]
                        });
                        agentCallbacks.onStep?.({
                            kind: 'observation',
                            title: reentryDecision.qualityHalt === 'escalate_human'
                                ? '质量返工停止：转人工裁决'
                                : '质量返工停止：已达最大轮数',
                            detail: qualityHaltNotice,
                            status: 'error',
                            source: 'skill_executor',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                    }
                    break;
                }

                reflexionReentryCount = reentryDecision.reentryCount;
                previousReflexionFailureSignature = reentryDecision.failureSignature;
                agentCallbacks.onStep?.({
                    kind: 'observation',
                    title: `复盘后自动返工（第 ${reflexionReentryCount} 次）`,
                    detail: reentryDecision.injectedConstraints.slice(0, 2).join('；'),
                    status: 'running',
                    iteration: reflexionReentryCount,
                    maxIterations,
                    source: 'skill_executor',
                    audience: 'user',
                    visibility: 'user_process'
                });
                const reentryTask = String(userTask);
                incomingReflexionHandoff = {
                    ...reflexionHandoff,
                    nextRoundConstraints: reentryDecision.injectedConstraints.slice(0, 12)
                };
                // 标记本次是失败复盘后的自动重跑，供后续运行记录与策略读取。
                runtimeParams.reflexionReentryInProgress = true;
                // V0-4：把上一轮 run-record checkpoint 的确定性旗标（documentCreated/layoutRendered）
                // 播种给下一轮纪律状态机——重入时 createExecuteToolWrapper 会新建全 false 的 disciplineState，
                // 不回灌就与续跑 brief 自相矛盾（brief 说文档已存在、纪律却强制 createDocument 旁建空文档）。
                // 累积并集（旗标只增不减）：与上一轮已有种子取 OR，避免"某轮工具日志无建档/排版→单轮派生退回
                // 全 false→下一轮病灶复现"的多轮衰减（对抗核验 finding）。派生纯读上一轮 result，无 IPC/FS 副作用。
                {
                    const derivedReflexionSeed = deriveReflexionDisciplineSeed(result);
                    const prevReflexionSeed = runtimeParams.reflexionDisciplineSeed as Partial<DesignDisciplineState> | undefined;
                    runtimeParams.reflexionDisciplineSeed = (prevReflexionSeed || derivedReflexionSeed)
                        ? {
                            documentCreated: Boolean(prevReflexionSeed?.documentCreated) || Boolean(derivedReflexionSeed?.documentCreated),
                            layoutRendered: Boolean(prevReflexionSeed?.layoutRendered) || Boolean(derivedReflexionSeed?.layoutRendered)
                        }
                        : undefined;
                }
                // 被复盘取代的这一轮也要留档（失败轨迹是 Eval 的原料），并把 runId 链给下一轮
                lastRunRecordId = persistAgentRunRecordSafely({
                    result,
                    userTask: String(userTask),
                    controlPlane: runtimeParams.agentIntentControlPlane,
                    projectPath: runRecordProjectPath,
                    projectState: designProjectStateForFreshness,
                    parentRunId: runtimeSessionIdentity ? undefined : lastRunRecordId,
                    resumeFreshness: runResumeFreshness,
                    runtimeSessionIdentity
                });
                if (runtimeContractBundle) {
                    const previousSession = readRuntimeSessionFromAgentResult(result);
                    if (!previousSession || !runtimeSessionIdentity) {
                        throw new Error('runtime_session_generation_seed_missing');
                    }
                    if (previousSession.identity.runId !== runtimeSessionIdentity.runId) {
                        throw new Error('runtime_session_generation_result_identity_mismatch');
                    }
                    if (previousSession.stageState.status !== 'reflexion_required') {
                        qualityHaltNotice = '当前版本已经产生处理记录，但自动返工没有进入可安全承接的状态。已保留现有结果并停止继续写入，请先复核当前画面。';
                        break;
                    }
                    const nextAuthorization = await authorizeRuntimeArtifactFinalizationForProject({
                        projectPath: runRecordProjectPath,
                        requestId: createRuntimeSessionNonce(),
                        skillId: runtimeContractBundle.stagePlan.skillId,
                        taskType: runtimeContractBundle.stagePlan.taskType,
                        previousRunId: runtimeSessionIdentity.runId
                    });
                    const nextIdentity = nextAuthorization?.runtimeIdentity
                        || advanceRuntimeSessionIdentity({
                            previous: runtimeSessionIdentity,
                            now: new Date().toISOString(),
                            nonce: createRuntimeSessionNonce()
                        });
                    if (nextAuthorization) {
                        runtimeArtifactAuthorizationTokens.set(
                            nextAuthorization.runtimeIdentity.runId,
                            nextAuthorization.authorizationToken
                        );
                    }
                    const nextSession = advanceRuntimeSessionGeneration({
                        previous: previousSession,
                        identity: nextIdentity,
                        plan: runtimeContractBundle.stagePlan
                    });
                    runtimePlanningContextSeed = buildRuntimePlanningContextSeed({
                        previousSession,
                        nextSession,
                        plan: runtimeContractBundle.stagePlan,
                        declarations: readRuntimePlanningDeclarationsFromAgentResult(result)
                    });
                    runtimeSessionSeed = nextSession;
                    runtimeSessionIdentity = nextIdentity;
                }
                result = await createAutonomousAgent().run(reentryTask, runtimeParams.images);
                accumulatedSuccessfulMutationCalls += countSuccessfulMutationCalls(result);
            }

            if (result.cancelled) {
                // 取消也留档：中断轨迹是 H2 续跑与 Eval 的原料
                persistAgentRunRecordSafely({
                    result,
                    userTask: String(userTask),
                    controlPlane: runtimeParams.agentIntentControlPlane,
                    projectPath: runRecordProjectPath,
                    projectState: designProjectStateForFreshness,
                    parentRunId: runtimeSessionIdentity ? undefined : lastRunRecordId,
                    resumeFreshness: runResumeFreshness,
                    runtimeSessionIdentity
                });
                return buildCancelledAutonomousAgentResult(result);
            }

            const finalGenerationSuccessfulMutationCalls = countSuccessfulMutationCalls(result);
            const priorGenerationSuccessfulMutationCalls = Math.max(
                0,
                accumulatedSuccessfulMutationCalls - finalGenerationSuccessfulMutationCalls
            );
            const finalGenerationCompleted = result.success === true
                && result.executionSummary?.status === 'completed';
            const mutationCarryoverNotice = priorGenerationSuccessfulMutationCalls > 0
                && !finalGenerationCompleted
                ? `当前版本在前一轮已经产生画面或文件改动（成功写入 ${priorGenerationSuccessfulMutationCalls} 次），但后续复核没有完成。已停止自动重放，请先查看当前文档。`
                : undefined;
            if (reflexionReentryCount > 0 || priorGenerationSuccessfulMutationCalls > 0) {
                result = {
                    ...result,
                    ...(mutationCarryoverNotice
                        ? { message: [result.message, mutationCarryoverNotice].filter(Boolean).join('\n\n') }
                        : {}),
                    data: {
                        ...(result.data || {}),
                        reflexionMutationSummary: {
                            totalSuccessfulMutationCalls: accumulatedSuccessfulMutationCalls,
                            priorGenerationSuccessfulMutationCalls,
                            finalGenerationSuccessfulMutationCalls,
                            changedAcrossRun: accumulatedSuccessfulMutationCalls > 0
                        }
                    }
                };
            }

            const finalRunRecordId = persistAgentRunRecordSafely({
                result,
                userTask: String(userTask),
                controlPlane: runtimeParams.agentIntentControlPlane,
                projectPath: runRecordProjectPath,
                projectState: designProjectStateForFreshness,
                parentRunId: runtimeSessionIdentity ? undefined : lastRunRecordId,
                resumeFreshness: runResumeFreshness,
                runtimeSessionIdentity
            });

            const designRunRecord = designDisciplineActive
                ? deriveDesignTaskRunRecord({
                    executionCompleted: result.executionSummary?.status === 'completed',
                    overallSuccess: result.success === true,
                    label: designDisciplineContext.label,
                    toolEntries: (result.toolCallLog || []).map((entry) => ({
                        name: entry.name,
                        succeeded: entry.result?.success !== false,
                        visualReviewed: entry.result?.agentVisualObservation?.reviewed === true
                    }))
                })
                : undefined;
            const runtimeTaskSnapshot = readRuntimeTaskSnapshot((
                result.data as Record<string, unknown> | undefined
            )?.runtimeTaskSnapshot);
            return {
                success: result.success,
                // 质量停机（转人工/达上限）时在结果说明里如实附上卡点与各轮分数轨迹——只补说明，不改成败裁决。
                message: qualityHaltNotice ? `${result.message}\n\n${qualityHaltNotice}` : result.message,
                error: result.error,
                data: {
                    ...(designRunRecord ? {
                        status: designRunRecord.status,
                        canClaimOutputQuality: designRunRecord.canClaimOutputQuality,
                        outputCount: designRunRecord.outputCount,
                        warnings: designRunRecord.warnings,
                        designRunRecord
                    } : {}),
                    // 透传自主循环停在确认点时的交互卡片，让 UI 渲染并等待用户确认——不自动确认。
                    ...(Array.isArray((result as any).data?.interactiveCards) && (result as any).data.interactiveCards.length > 0 ? {
                        interactiveCards: (result as any).data.interactiveCards,
                        awaitingUserConfirmation: (result as any).data.awaitingUserConfirmation === true,
                        ...((result as any).data.pendingInteractiveContinuation ? {
                            pendingInteractiveContinuation: (result as any).data.pendingInteractiveContinuation
                        } : {})
                    } : {}),
                    iterations: result.iterations,
                    stopReason: result.stopReason,
                    executionSummary: result.executionSummary,
                    toolCallLog: result.toolCallLog,
                    performanceBudget: runtimeBudget,
                    runtimeContextCompilation: {
                        version: compiledRuntimeContext.version,
                        includedItemIds: compiledRuntimeContext.includedItemIds,
                        rejectedItemIds: compiledRuntimeContext.rejectedItemIds,
                        issues: compiledRuntimeContext.issues,
                        metrics: compiledRuntimeContext.metrics,
                        boundaries: compiledRuntimeContext.boundaries
                    },
                    runtimeContractStatus,
                    ...(result.executionSummary?.runtimeSessionDigest
                        ? { runtimeSessionDigest: result.executionSummary.runtimeSessionDigest }
                        : {}),
                    ...(runtimeTaskSnapshot ? { runtimeTaskSnapshot } : {}),
                    capabilityResolution: capabilitySession.getResolution(),
                    ...(runResumeFreshness ? { actionPlanResumeFreshness: runResumeFreshness } : {}),
                    // Harness v1：本轮运行记录引用（完整记录在 <project>/.designecho/runs/<runId>.json）
                    ...(finalRunRecordId ? {
                        runRecordRef: {
                            runId: finalRunRecordId,
                            ...(runtimeSessionIdentity ? {
                                sessionId: runtimeSessionIdentity.sessionId,
                                generation: runtimeSessionIdentity.generation
                            } : {})
                        }
                    } : {})
                }
            };
        } catch (error: any) {
            console.error('[AutonomousAgent] runtime failure:', error);
            const rawFailure = String(error?.message || 'unknown_runtime_failure');
            // 多主选择歧义是用户可立即修正的输入问题：把可操作文案直接给用户，
            // 不埋进笼统的"运行异常"里。
            const ambiguousSelection = /^operating_context_ambiguous_primary_selection[:：](.*)$/.exec(rawFailure);
            if (ambiguousSelection) {
                const safeMessage = ambiguousSelection[1]?.trim()
                    || '同时选中了多个主目标（工作流节点、项目素材或 Eagle 素材），请只保留一个目标后重试。';
                return {
                    success: false,
                    message: safeMessage,
                    error: safeMessage,
                    data: {
                        runtimeFailureCode: rawFailure
                    }
                };
            }
            const safeMessage = '处理过程中出现运行异常，当前结果不能确认完成。为避免继续改动画面，已停止执行，请先检查当前文档。';
            return {
                success: false,
                message: safeMessage,
                error: safeMessage,
                data: {
                    runtimeFailureCode: rawFailure
                }
            };
        }
    }
};
