/**
 * 对话面板
 * 参考 Lovart (https://lovart.ai) 和 Manus (https://manus.im) 的设计理念
 * 
 * 重构说明：
 * - 业务逻辑已抽离到 useChatActions Hook
 * - 本文件主要负责 UI 渲染和状态管理
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/app.store';
import { SuggestionList, TextSuggestion } from './SuggestionList';
import { ReferenceUpload } from './ReferenceUpload';
import { ReferenceReplicator } from './ReferenceReplicator';
import { LayoutFixList, LayoutFix } from './LayoutFixList';
import { ThinkingModeControl } from './ThinkingModeControl';
import { ThinkingProcess, ThinkingStep } from './ThinkingProcess';
import './ThinkingProcess.css';

// 多模态消息渲染
import { MessageRenderer, convertLegacyMessage } from './message';
import type { MultimodalMessage } from './message';
import type { AssetSelectionContext } from './AssetGallery';
import type { EagleLibrarySelectionContext } from '../../shared/eagle-library';
import type { EagleAssetRef } from '../../shared/eagle-asset-ref';
import type { WorkflowSelectionContext } from './WorkflowBoard';
import { KNOWLEDGE_REFERENCE_USE_ROLES, type KnowledgeSelectionReference } from '../../shared/knowledge-selection-context';

// 从工具执行服务导入核心功能
import { executeToolCall } from '../services/tool-executor.service';
import { submitVisualObservationCardAction } from '../../shared/agent-runtime-v5/detail-page-card-controller';
import {
    resolvePendingDestructiveActionSubmission,
    type PendingDestructiveActionCard
} from '../../shared/pending-destructive-action-card';
import type { VisualObservationBlockedCard } from '../../shared/agent-runtime-v5/visual-observation-card';
import {
    buildOperatingContextSnapshot,
    resolveOperatingPhotoshopConnection,
    type OperatingWorkflowContext
} from '../../shared/agent-runtime-v5/operating-context-snapshot';
// 触发详情页结构 preset 自注册（structure_only 骨架按 taskType 取 preset 必需）
import '../../shared/agent-runtime-v5/manifests/detail-page.structure-preset';

// 保留 useChatActions Hook 的模型选择功能
import { useChatActions } from '../hooks/useChatActions';
import {
    createDesignImageInputs,
    injectImagesIntoLastUserMessage
} from '../../shared/design-image-input';
import { buildAgentResumeReadonlyToolHandlers } from '../services/agent-orchestration/resume-readonly-handlers';
import { createPublicPlanPhotoshopAdapter } from '../services/agent-orchestration/public-plan-photoshop-adapter';

// 导入统一 AI Agent 服务
import { 
    processWithUnifiedAgent, 
    debugInferDecisionFromText,
    capturePhotoshopRequestContext,
    getProjectContext,
    type AgentContext,
    type AgentUserVisibleNotice
} from '../services/unified-agent.service';
import type { AgentExecutionSummary, AgentStepEvent } from '../services/agent-runtime/types';
import {
    buildAgentDiagnosticRecord,
    type AgentDiagnosticRecord
} from '../../shared/agent-diagnostic-record';
import {
    formatAssistantBusinessVisualFeedbackContent,
    formatAssistantFailureContent,
    sanitizeUserVisibleAgentText,
    sanitizeUserVisibleAssistantBodyText,
    sanitizeUserVisibleDiagnosticText,
    sanitizeUserVisibleThinkingText,
    finalizeUserVisibleThinkingText
} from '../../shared/chat-response-cleaner';
import { sanitizeUiActionToolParams } from '../../shared/ui-action-tool-params';
import {
    extractRuntimeOperationRequestsFromPublicPlanExecutionRequest,
    stripRuntimeParamsFromPublicPlanExecutionRequest,
    type AgentTaskPublicPlanControlledOperationRequest,
    type AgentTaskPublicPlanExecutionRequest
} from '../../shared/agent-task-public-plan-execution-request';
import {
    stripRuntimeParamsFromPublicPlanControlledRun,
    type AgentTaskPublicPlanControlledRun
} from '../../shared/agent-task-public-plan-controlled-runner';
import type { AgentRequestLifecycleRecord } from '../../shared/agent-request-lifecycle';
import {
    buildAgentTaskPlanPresentation,
    type AgentTaskPlanPresentation
} from '../../shared/agent-task-plan-presentation';
import { readRuntimeTaskSnapshot } from '../../shared/agent-runtime-v5/runtime-task-snapshot';
import {
    buildUserStoppedResponseInterruption,
    isAgentResponseInterruptionSentinelContent,
    resolveAgentResponseInterruption
} from '../../shared/agent-response-interruption';
import { decideAgentRunResultDisposition } from '../../shared/agent-run-result-disposition';
import type { BusinessSkillVisualObservationFeedback } from '../../shared/business-skill-visual-observation-feedback';
import type { SkuDeliverySummary } from '../../shared/sku-delivery-summary';
import {
    deterministicBlockerReplyOrigin,
    modelAuthoredReplyOrigin,
    testFixtureReplyOrigin,
    toolSummaryReplyOrigin,
    uiStatusReplyOrigin,
    type AssistantReplyOrigin
} from '../../shared/assistant-reply-origin';
import {
    canObservationEnterThinkingSteps,
    classifyAgentObservationChannel
} from '../../shared/agent-observation-channels';
import { isSimpleDeterministicShortPathSkill } from '../../shared/agent-route-boundary-policy';
import {
    callPhotoshopMcpTool,
    getPhotoshopConnectionStatus,
    listPhotoshopMcpTools
} from '../services/mcp-host.client';
import { streamChatAsync } from '../services/stream-chat.service';
import { canUsePlainTextProviderStream } from '../services/agent-orchestration/streaming-policy';
import { summarizeChatError } from '../services/agent-orchestration/chat-error-summary';
import {
    getModelPriorityForConversationTask,
    getModelRecoveryPriorityForConversationTask,
    resolveConversationTaskTypeForModelPurpose,
    type ConversationTaskType
} from '../../shared/model-selection';
import { hasExplicitGeneratedPublicPlanApproval } from '../../shared/generated-public-plan-approval-policy';
import {
    buildProviderNativeToolPlan,
    type ProviderNativeToolRequest
} from '../../shared/provider-native-tools';
import {
    formatChatWebSearchCompletedStep,
    formatChatWebSearchVisibleStep,
    resolveChatWebSearchIntent,
    toProviderNativeWebSearchIntent,
    type ChatWebSearchIntent
} from '../../shared/chat-web-search-policy';
import {
    buildVisibleAgentActivityFromProgress,
    buildVisibleAgentActivityFromRunPhase,
    buildVisibleAgentActivityFromStepEvent,
    formatAgentProcessEventContent,
    formatAgentToolEventContent,
    getVisibleAgentProcessStepType,
    isVisibleAgentStepEvent,
    isVisibleAgentProcessEvent,
    isVisiblePonderingStep,
    type VisibleAgentActivity
} from '../services/agent-visible-feedback';
import { getToolDisplayInfo } from '../services/tool-display-info';
import { getMemoryService } from '../services/memory.service';
import {
    claimInteractiveContinuationOperation,
    getInteractiveContinuationOperation,
    markInteractiveContinuationOperationUnknown
} from '../services/interactive-continuation-operation-client';
import type { InteractiveContinuationOperationIdentity } from '../../shared/interactive-continuation-operation';
import {
    buildInteractiveCardSubmission,
    cleanInteractiveCardText,
    type InteractiveCardDefinition,
    type InteractiveCardSubmission
} from '../../shared/interactive-card-contract';
import {
    buildInteractiveCardSubmissionDecision,
    type InteractiveContinuationRequest,
    type PendingInteractiveContinuation
} from '../../shared/pending-interactive-continuation';
import {
    buildSkuComboApprovedRecipeMemory,
    stringifySkuCombo,
    validateSkuComboEditorValue,
    type SkuComboEditorCard,
    type SkuComboEditorValue
} from '../../shared/sku-combo-interactive-card';
import {
    buildEditableConfirmationApprovedMemory,
    validateEditableConfirmationValue,
    type EditableConfirmationCard,
    type EditableConfirmationValue
} from '../../shared/editable-confirmation-interactive-card';
import {
    buildSkuHumanReviewIntakeFromCard,
    isSkuHumanReviewCard,
    validateSkuHumanReviewCardValue
} from '../../shared/sku-human-review';
import {
    buildDesignProjectFactReviewPatch,
    doesDesignProjectFactReviewCardMatchState,
    getDesignProjectFactReviewCardSummary,
    isDesignProjectFactReviewCard,
    validateDesignProjectFactReviewCardValue
} from '../../shared/design-project-fact-review-card';
import {
    buildDesignProjectRuleReviewPatch,
    doesDesignProjectRuleReviewCardMatchState,
    getDesignProjectRuleReviewCardSummary,
    isDesignProjectRuleReviewCard,
    validateDesignProjectRuleReviewCardValue
} from '../../shared/design-project-rule-review-card';

// 导入模型配置
import {
    BFL_MODELS,
    getModelById,
    isModelThinkingUserControllable,
    normalizeModelThinkingPreference,
    resolveModelThinkingEnabledForCall,
    type ModelPreferences
} from '../../shared/config/models.config';
// 主模型候选列表（与设置页「AI 模型 · 主模型」同一口径，见模块头注释）
import {
    buildPrimaryModelOptionGroups,
    formatPrimaryModelShortName,
    isModelIdInPrimaryModelOptionGroups
} from '../../shared/config/primary-model-options';

type PhotoshopMcpToolsListPayload = {
    tools?: unknown[];
    result?: { tools?: unknown[] };
};

type ChatSendOverride = {
    text?: string;
    image?: { data: string; type: string } | null;
    publicPlanConfirmationSourceMessageId?: string;
    publicPlanDisposableLiveAdapter?: boolean;
    interactiveContinuationRequest?: InteractiveContinuationRequest;
    expectedConversationId?: string;
    expectedProjectId?: string;
    expectedProjectPath?: string;
};

type PhotoshopMcpToolCallPayload = {
    error?: unknown;
    isError?: boolean;
    success?: boolean;
};

type LiveActivityState = VisibleAgentActivity;

function isDiagnosticsCommandEnabled(search = window.location.search || ''): boolean {
    try {
        const params = new URLSearchParams(search);
        return params.get('designechoDiagnostics') === '1'
            || (process.env.NODE_ENV === 'development'
                && params.get('designechoChatTestBridge') === '1');
    } catch {
        return false;
    }
}

function buildUserSlashHelpContent(): string {
    return `**可用命令**

- \`/optimize\` - 优化当前选中的文案
- \`/analyze\` - 分析当前文档的排版
- \`/status\` - 查看连接状态
- \`/clear\` - 清空对话历史
- \`/help\` - 显示此帮助信息

也可以直接输入设计需求，比如主图、SKU、详情页、图片理解或图层调整。`;
}

function isChatTestFakeModelRuntime(): boolean {
    try {
        return new URLSearchParams(window.location.search || '').get('designechoChatTestFakeModel') === '1';
    } catch {
        return false;
    }
}

function looksLikeChatTestFakeModelText(contentForOriginCheck?: unknown): boolean {
    const text = typeof contentForOriginCheck === 'string'
        ? contentForOriginCheck
        : String(contentForOriginCheck || '');
    if (!text.trim()) return false;
    return /测试\s*fixture\s*已收到请求|测试样本：|未调用真实模型或 Photoshop/u.test(text);
}

function normalizeAssistantReplyOriginForRuntime(
    origin: AssistantReplyOrigin | undefined,
    contentForOriginCheck?: unknown
): AssistantReplyOrigin | undefined {
    if (process.env.NODE_ENV !== 'development') return origin;
    const isFakeModelText = looksLikeChatTestFakeModelText(contentForOriginCheck);
    if (!origin) {
        return isFakeModelText
            ? testFixtureReplyOrigin('chat-test-fake-model:content-marker')
            : origin;
    }
    if (!isChatTestFakeModelRuntime() && !isFakeModelText) return origin;
    if (origin.origin !== 'model_authored' && origin.origin !== 'model_repaired') return origin;
    return testFixtureReplyOrigin(`chat-test-fake-model:${origin.source || 'unknown'}`);
}

function normalizeAgentUserVisibleNotice(input: unknown): AgentUserVisibleNotice | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const notice = input as Partial<AgentUserVisibleNotice>;
    const kind = notice.kind;
    if (kind !== 'status_notice' && kind !== 'tool_summary' && kind !== 'blocker_notice') {
        return undefined;
    }
    const content = String(notice.content || '').trim();
    if (!content) return undefined;
    const source = String(notice.source || '').trim();
    return {
        kind,
        content,
        ...(source ? { source } : {})
    };
}

function buildAgentUserVisibleNoticeOrigin(notice: AgentUserVisibleNotice): AssistantReplyOrigin {
    const source = notice.source || `agent-result:${notice.kind}`;
    if (notice.kind === 'blocker_notice') {
        return deterministicBlockerReplyOrigin(source);
    }
    if (notice.kind === 'tool_summary') {
        return toolSummaryReplyOrigin(source);
    }
    return uiStatusReplyOrigin(source);
}

function resolveAgentResultVisibleMessage(result: unknown): {
    content: string;
    assistantReplyOrigin?: AssistantReplyOrigin;
    userVisibleNotice?: AgentUserVisibleNotice;
} {
    const resultVisibleMessage = String((result as any)?.message || '');
    const resultUserVisibleNotice = normalizeAgentUserVisibleNotice(
        (result as any)?.userVisibleNotice || (result as any)?.data?.userVisibleNotice
    );
    const explicitOrigin =
        (result as any)?.assistantReplyOrigin
        || ((result as any)?.data?.assistantReplyOrigin as AssistantReplyOrigin | undefined);
    const noticeOrigin = resultUserVisibleNotice
        ? buildAgentUserVisibleNoticeOrigin(resultUserVisibleNotice)
        : undefined;
    const content = resultUserVisibleNotice?.content || resultVisibleMessage;

    return {
        content,
        assistantReplyOrigin: normalizeAssistantReplyOriginForRuntime(
            noticeOrigin || explicitOrigin,
            content
        ),
        ...(resultUserVisibleNotice ? { userVisibleNotice: resultUserVisibleNotice } : {})
    };
}

const STRUCTURED_AGENT_EXECUTION_STATUSES = new Set([
    'completed',
    'failed',
    'needs_review',
    'cancelled',
    'awaiting_confirmation'
]);

function normalizeAgentExecutionSummaryStatus(summary: Record<string, unknown>): AgentExecutionSummary {
    const rawStatus = String(summary.status || '').trim();
    if (!rawStatus || STRUCTURED_AGENT_EXECUTION_STATUSES.has(rawStatus)) {
        return summary as unknown as AgentExecutionSummary;
    }

    const existingWarnings = Array.isArray(summary.warnings)
        ? summary.warnings.map((warning) => String(warning || '').trim()).filter(Boolean)
        : [];
    const existingSummaryText = String(summary.summaryText || '').trim();
    return {
        ...summary,
        status: 'needs_review',
        summaryText: existingSummaryText || rawStatus,
        warnings: [
            ...existingWarnings,
            `执行状态字段不是结构化状态，已按需复核处理：${rawStatus.slice(0, 120)}`
        ]
    } as unknown as AgentExecutionSummary;
}

function readAgentExecutionSummaryFromResult(result: unknown): AgentExecutionSummary | undefined {
    const direct = (result as any)?.executionSummary;
    if (direct && typeof direct === 'object') {
        return normalizeAgentExecutionSummaryStatus(direct as Record<string, unknown>);
    }
    const nested = (result as any)?.data?.executionSummary;
    if (nested && typeof nested === 'object') {
        return normalizeAgentExecutionSummaryStatus(nested as Record<string, unknown>);
    }
    return undefined;
}

function buildRuntimePublicPlanLiveAdapterApproval(input: {
    enabled?: boolean;
    executeTool: typeof executeToolCall;
    projectPath?: string;
}) {
    if (input.enabled !== true) return {};

    const buildResult = createPublicPlanPhotoshopAdapter({
        approvedLiveAdapterRun: true,
        executionScope: 'disposable-document',
        executeTool: input.executeTool,
        projectPath: input.projectPath
    });
    if (buildResult.status !== 'ready_for_guarded_live_adapter' || !buildResult.adapter) {
        return {};
    }

    return {
        executionTarget: 'live-photoshop' as const,
        allowPhotoshopWrites: true,
        liveExecutionScope: 'disposable-document' as const,
        adapter: buildResult.adapter
    };
}

function extractUserVisibleErrorSource(error: unknown, fallback = '未知错误'): string {
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error || fallback;
    if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        return typeof message === 'string' && message.trim() ? message : fallback;
    }
    return fallback;
}

function formatUserVisibleFailureContent(title: string, error: unknown, fallback = '未知错误'): string {
    return formatAssistantFailureContent({
        prefix: '❌ ',
        message: title,
        error: extractUserVisibleErrorSource(error, fallback)
    });
}

function formatUserVisibleFailureLine(label: string, error: unknown, fallback = '失败'): string {
    const detail = sanitizeUserVisibleDiagnosticText(extractUserVisibleErrorSource(error, fallback)) || fallback;
    return `❌ ${label}: ${detail}`;
}

function sanitizeTestSnapshotPreview(value: unknown, fallback = ''): string {
    const text = String(value || '').trim();
    if (!text) return fallback;
    return sanitizeUserVisibleAssistantBodyText(text)
        || sanitizeUserVisibleDiagnosticText(text)
        || fallback;
}

function sanitizeTestSnapshotToken(value: unknown, fallback = ''): string {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    return text || fallback;
}

function formatTestSnapshotThinkingStep(step: any): string {
    const toolDisplayName = step?.toolName
        ? getToolDisplayInfo(String(step.toolName)).name
        : '';
    return [
        sanitizeTestSnapshotToken(step?.type),
        toolDisplayName,
        sanitizeTestSnapshotPreview(step?.content),
        sanitizeTestSnapshotToken(step?.status)
    ].filter(Boolean).join(': ');
}

function readTestSnapshotRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function summarizePublicPlanControlledRunOperationResults(run: unknown): Array<{
    toolName: string;
    success: boolean;
    error: string;
    dataErrors: string[];
}> {
    const runRecord = readTestSnapshotRecord(run);
    const operationResults = Array.isArray(runRecord.operationResults)
        ? runRecord.operationResults
        : [];
    return operationResults
        .map((item) => {
            const result = readTestSnapshotRecord(item);
            const data = readTestSnapshotRecord(result.data);
            const dataErrors = Array.isArray(data.errors)
                ? data.errors
                    .map((errorItem) => {
                        const errorRecord = readTestSnapshotRecord(errorItem);
                        const block = sanitizeTestSnapshotToken(errorRecord.block);
                        const role = sanitizeTestSnapshotToken(errorRecord.role);
                        const error = sanitizeTestSnapshotPreview(errorRecord.error).slice(0, 300);
                        return [block, role, error].filter(Boolean).join(': ');
                    })
                    .filter(Boolean)
                    .slice(0, 8)
                : [];
            return {
                toolName: sanitizeTestSnapshotToken(result.toolName),
                success: result.success === true,
                error: sanitizeTestSnapshotPreview(result.error).slice(0, 500),
                dataErrors
            };
        })
        .filter((item) => item.toolName)
        .slice(0, 12);
}

function collectChatSnapshotVisibleStrings(value: unknown, output: string[] = [], key = ''): string[] {
    if (value === null || value === undefined) return output;
    const visiblePrimitiveKeys = new Set([
        'title',
        'content',
        'label',
        'value',
        'text',
        'description',
        'message',
        'summary',
        'actionHint'
    ]);
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        if (key && !visiblePrimitiveKeys.has(key)) return output;
        const preview = sanitizeTestSnapshotPreview(value);
        if (preview) output.push(preview);
        return output;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectChatSnapshotVisibleStrings(item, output, key));
        return output;
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (record.collapsible === true && record.defaultCollapsed === true) {
            collectChatSnapshotVisibleStrings(record.title, output, 'title');
            return output;
        }
        Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
            if ([
                'id',
                'type',
                'variant',
                'icon',
                'status',
                'timestamp',
                'style',
                'metadata',
                'collapsible',
                'defaultCollapsed',
                'action',
                'params',
                'payload',
                'result',
                'toolResult',
                'progress',
                'current',
                'total'
            ].includes(key)) return;
            collectChatSnapshotVisibleStrings(child, output, key);
        });
    }
    return output;
}

function resolveChatSnapshotAgentUserVisibleState(message: unknown) {
    const state = (message as any)?.agentTaskPlan?.userVisibleState;
    if (!state || state.version !== 'agent-user-visible-state/v0') return undefined;
    const category = String(state.category || '').trim();
    const toolUse = String(state.toolUse || '').trim();
    const title = sanitizeTestSnapshotPreview(state.title);
    const categoryAllowed = ['conversation', 'clarification', 'read_only', 'planning', 'tool_execution', 'controlled_execution', 'blocked'].includes(category);
    const toolUseAllowed = ['no_tools', 'read_only', 'direct_tools', 'controlled_write_after_gate', 'blocked'].includes(toolUse);
    if (!categoryAllowed || !toolUseAllowed) return undefined;
    if (!title || !category || !toolUse) return undefined;
    return {
        category,
        title,
        toolUse,
        summaryPreview: sanitizeTestSnapshotPreview(state.summary).slice(0, 500),
        nextStepPreview: sanitizeTestSnapshotPreview(state.nextStep).slice(0, 500),
        canStartTools: state.canStartTools === true,
        userActionRequired: state.userActionRequired === true
    };
}

function shouldDropCompletedMechanicalThinking(
    step: ThinkingStep,
    lifecycle?: AgentRequestLifecycleRecord
): boolean {
    if (step.type !== 'thinking') return false;
    const content = String(step.content || '').trim();
    const observation = classifyAgentObservationChannel({
        source: 'model_visible_reasoning',
        content
    });
    const isBlockedLocalPlaceholder = observation.channel === 'blocked'
        && observation.userVisible === false
        && observation.canPersistToThinkingSteps === false;
    const isMechanicalProcessCopy = isBlockedLocalPlaceholder || /^(工具完成|执行\s|已开始执行|准备调用)/.test(content);
    if (!isMechanicalProcessCopy) return false;
    const skillId = lifecycle?.decision?.skillId || lifecycle?.execution?.expectedExecutor;
    return lifecycle?.decision?.source === 'deterministic_route'
        && lifecycle?.decision?.route === 'skill_execution'
        && lifecycle?.execution?.kind === 'deterministic_skill'
        && isSimpleDeterministicShortPathSkill(skillId);
}

function shouldPersistVisibleProcessStep(
    step: ThinkingStep,
    lifecycle?: AgentRequestLifecycleRecord
): boolean {
    if (lifecycle?.decision?.route === 'direct_response' || lifecycle?.execution?.kind === 'none') {
        return false;
    }
    return isVisiblePonderingStep(step) && !shouldDropCompletedMechanicalThinking(step, lifecycle);
}

function normalizePersistedVisibleProcessSteps(steps?: ThinkingStep[]): ThinkingStep[] | undefined {
    if (!Array.isArray(steps) || steps.length === 0) return undefined;
    const normalizedSteps = steps.flatMap((step) => {
        const normalizedContent = step.type === 'thinking'
            ? finalizeUserVisibleThinkingText(step.content)
            : step.content;
        if (step.type === 'thinking' && !normalizedContent) {
            return [];
        }
        return {
            ...step,
            content: normalizedContent,
            status: step.status === 'running' || step.status === 'pending'
                ? 'success'
                : step.status
        };
    });
    return normalizedSteps.length > 0 ? normalizedSteps : undefined;
}

function normalizeStoppedVisibleProcessSteps(steps?: ThinkingStep[]): ThinkingStep[] | undefined {
    if (!Array.isArray(steps) || steps.length === 0) return undefined;
    return normalizePersistedVisibleProcessSteps(
        steps.filter((step) => step.status === 'success' || step.status === 'error')
    );
}

function shouldIncludeMessageInAgentConversationHistory(message: {
    content?: unknown;
    agentResponseInterruption?: unknown;
    assistantReplyOrigin?: unknown;
}): boolean {
    if (!resolveAgentResponseInterruption({
        interruption: message.agentResponseInterruption,
        assistantReplyOrigin: message.assistantReplyOrigin,
        content: message.content
    })) {
        return true;
    }
    return typeof message.content === 'string'
        && message.content.trim().length > 0
        && !isAgentResponseInterruptionSentinelContent(message.content);
}

function normalizeComparableVisibleText(value: unknown): string {
    return sanitizeUserVisibleDiagnosticText(String(value || ''))
        .replace(/^[\s⚠️❌✅!！i]+/, '')
        .replace(/^(?:错误|Error)\s*[:：]\s*/i, '')
        .replace(/[。！？!?,，、；;：:\s]/g, '')
        .trim();
}

function uniqueModelIds(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const modelId = String(value || '').trim();
        if (!modelId || seen.has(modelId)) continue;
        seen.add(modelId);
        result.push(modelId);
    }
    return result;
}

function resolveComposerThinkingModelIds(preferences?: Partial<ModelPreferences> | null): string[] {
    const tasks: ConversationTaskType[] = ['general', 'logic', 'copywriting', 'visual'];
    const ids = tasks.flatMap((taskType) => [
        ...getModelPriorityForConversationTask(preferences, taskType, { includeFallback: true }),
        ...getModelRecoveryPriorityForConversationTask(preferences, taskType)
    ]);

    return uniqueModelIds(ids).filter(isModelThinkingUserControllable);
}

const PROVIDER_NATIVE_WEB_SEARCH_MODEL_PRIORITY = [
    'xiaomi-mimo-v2.5-pro',
    'xiaomi-mimo-v2.5'
];

function getProviderNativeWebSearchModelPriority(apiKeys: unknown): string[] {
    const apiKeyRecord = (apiKeys || {}) as Record<string, unknown>;
    return PROVIDER_NATIVE_WEB_SEARCH_MODEL_PRIORITY.filter((modelId) => {
        const model = getModelById(modelId);
        if (!model || model.provider !== 'xiaomi') return false;
        const requiredApiKey = model.requiredApiKey;
        return !requiredApiKey || Boolean(String(apiKeyRecord[requiredApiKey] || '').trim());
    });
}

function compactModelFailureText(value: unknown): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function looksLikeProviderFailureText(value: unknown): boolean {
    const text = compactModelFailureText(value);
    if (!text || text.length > 1200) return false;
    return /\b(?:provider\s*http|http\s*(?:401|403|429|500|502|503)|status\s*(?:401|403|429|500|502|503)|401|403|unauthorized|forbidden|invalid\s+api\s+key|api[_-]?key[_-]?invalid|authentication|permission_denied|quota_exceeded|rate\s*limit)\b/i.test(text)
        || /(?:认证|鉴权|授权|权限|密钥|额度|限流|接口调用)失败|API\s*Key\s*(?:无效|错误|未配置|不可用)|(?:无效|错误|未配置|不可用)的\s*API\s*Key|当前已选模型认证失败/i.test(text);
}

function extractModelCallFailureMessage(response: unknown): string | null {
    if (!response) return 'empty response';
    if (typeof response === 'string') {
        return looksLikeProviderFailureText(response) ? compactModelFailureText(response) : null;
    }
    if (typeof response !== 'object') return null;

    const payload = response as {
        success?: unknown;
        ok?: unknown;
        error?: unknown;
        message?: unknown;
        text?: unknown;
        reason?: unknown;
        code?: unknown;
        status?: unknown;
    };
    const explicitFailure = payload.success === false || payload.ok === false || Boolean(payload.error);
    const explicitFailureText = compactModelFailureText(
        payload.error || payload.message || payload.reason || payload.text
    );
    if (explicitFailure) {
        return explicitFailureText || 'model call failed';
    }

    const codeOrStatus = compactModelFailureText(payload.code || payload.status);
    if (looksLikeProviderFailureText(codeOrStatus)) {
        return codeOrStatus;
    }

    const text = compactModelFailureText(payload.text || payload.message);
    if (looksLikeProviderFailureText(text)) {
        return text;
    }

    return null;
}

function filterRedundantFailureProcessSteps(
    steps: ThinkingStep[],
    failureContent: string
): ThinkingStep[] {
    const normalizedFailure = normalizeComparableVisibleText(failureContent);
    if (!normalizedFailure) return steps;

    return steps.filter((step) => {
        const normalizedStep = normalizeComparableVisibleText(step.content);
        if (normalizedStep.length < 8) return true;
        return !normalizedFailure.includes(normalizedStep);
    });
}

const LiveActivityIndicator: React.FC<{ activity: LiveActivityState }> = ({ activity }) => (
    <div
        className="thinking-simple live-thinking live-activity-placeholder"
        aria-live="polite"
        data-testid="live-agent-activity"
    >
        <div className="pondering-header">
            <span className="pondering-dot"></span>
            <span className="pondering-title">{activity.detail || activity.agentLabel}</span>
        </div>
    </div>
);

// 模型配置导入已移至 useChatActions hook

// 日志工具函数 - 同时输出到控制台和日志文件
const agentLog = (level: 'info' | 'warn' | 'error', message: string, data?: any) => {
    const prefix = {
        info: '[Agent] ℹ️',
        warn: '[Agent] ⚠️',
        error: '[Agent] ❌'
    }[level];
    
    // 输出到控制台
    if (data) {
        console.log(`${prefix} ${message}`, data);
    } else {
        console.log(`${prefix} ${message}`);
    }
    
    // 写入到日志文件
    if (window.designEcho?.writeLog) {
        window.designEcho.writeLog(level, message, data);
    }
};

// V1-7b 幂等守卫：一张破坏性动作确认卡只处理一次，防重复点击=重复确定性重放（对非幂等的
// interactWithBrowserPage click 尤其致命：重复=重复下单/支付）。模块级 Set 跨消息列表重渲染存活、
// 会话内持久；单一 ChatPanel 实例。执行前登记 card.id，二次点击直接跳过。
const submittedDestructiveActionCardIds = new Set<string>();
const submittedSkuHumanReviewCardIds = new Set<string>();
const submittedDesignProjectFactReviewCardIds = new Set<string>();
const submittedDesignProjectRuleReviewCardIds = new Set<string>();

interface ChatPanelProps {
    externalDraft?: string;
    externalDraftRevision?: number;
    activeWorkspacePage?: string;
    workflowSelectionContext?: WorkflowSelectionContext | null;
    selectedAssetContext?: AssetSelectionContext | null;
    selectedEagleLibraryAsset?: EagleLibrarySelectionContext | null;
    /** 多素材选择集（P4）：Eagle 页多选时的一组路径安全引用；与唯一主选互斥 */
    selectedEagleAssetGroup?: EagleAssetRef[] | null;
    knowledgeReferences?: KnowledgeSelectionReference[];
    onClearWorkflowSelection?: () => void;
    onClearSelectedAssetContext?: () => void;
    onClearSelectedEagleLibraryAsset?: () => void;
    onRemoveKnowledgeReference?: (bindingRef: string) => void;
}

function toOperatingWorkflowContext(
    context?: WorkflowSelectionContext | null
): OperatingWorkflowContext | undefined {
    if (!context) return undefined;
    const selectedNode = context.selectedNode;
    return {
        documentId: context.workflowDocument.id,
        lifecycle: context.workflowDocument.state,
        revision: context.graph.revision,
        ...(selectedNode ? {
            selectedNode: {
                nodeId: selectedNode.id,
                kind: selectedNode.data.kind,
                title: selectedNode.data.title,
                subtitle: selectedNode.data.subtitle,
                typeLabel: selectedNode.data.typeLabel
            }
        } : {})
    };
}

function buildOperatingWorkspaceRevision(input: {
    projectId?: string;
    projectPath?: string;
    activePage?: string;
    workflowRevision?: string;
    selectedWorkflowNodeId?: string;
    selectedAssetPath?: string;
    selectedLibraryAssetId?: string;
    knowledgeBindingRefs?: string[];
}): string {
    return [
        `project:${input.projectId || input.projectPath || 'none'}`,
        `page:${input.activePage || 'unknown'}`,
        `workflow:${input.workflowRevision || 'none'}`,
        `node:${input.selectedWorkflowNodeId || 'none'}`,
        `asset:${input.selectedAssetPath || 'none'}`,
        `libraryAsset:${input.selectedLibraryAssetId || 'none'}`,
        `knowledge:${(input.knowledgeBindingRefs || []).join(',') || 'none'}`
    ].join('|');
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    externalDraft,
    externalDraftRevision,
    activeWorkspacePage,
    workflowSelectionContext,
    selectedAssetContext,
    selectedEagleLibraryAsset,
    selectedEagleAssetGroup,
    knowledgeReferences = [],
    onClearWorkflowSelection,
    onClearSelectedAssetContext,
    onClearSelectedEagleLibraryAsset,
    onRemoveKnowledgeReference
}) => {
    const { 
        messages, addMessage, addMessageToConversation, updateMessage, updateMessageInConversation,
        currentConversationId, isLoading, setLoading, isPluginConnected, removeMessagesFrom,
        setAbortController, stopGeneration,
        modelPreferences,  // 获取用户模型偏好
        setModelPreferences,
        dynamicModels,  // 动态拉取模型注册表（主模型选择器候选的补全层，与设置页同源）
        designKnowledgeSettings,
        designDimensionSpec
    } = useAppStore();

    // 使用 Hook 获取业务逻辑（模型优先级、Agent 处理等）
    const { 
        // 智能模型协作
        detectTaskType
    } = useChatActions({ isPluginConnected });
    const [input, setInput] = useState('');
    const [showUpload, setShowUpload] = useState(false);  // 参考图上传面板
    const [showAttachMenu, setShowAttachMenu] = useState(false);  // 附件菜单（+按钮）
    const [referenceImage, setReferenceImage] = useState<string | null>(null);
    const [pastedImage, setPastedImage] = useState<{ data: string; type: string } | null>(null);  // 粘贴的图片
    const [isDraggingImage, setIsDraggingImage] = useState(false);  // 拖拽状态
    
    // 图片生成状态
    const [showImageGen, setShowImageGen] = useState(false);  // 显示图片生成下拉菜单
    const [selectedImageModel, setSelectedImageModel] = useState<string>('bfl-flux2-max');  // 选中的图片生成模型
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);  // 是否正在生成图片
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const inputAreaRef = useRef<HTMLDivElement>(null);
    const handleSendRef = useRef<((override?: ChatSendOverride) => Promise<void>) | null>(null);
    const chatSubmissionInFlightRef = useRef(false);
    const publicPlanPrivateOperationRequestsRef = useRef<Record<string, AgentTaskPublicPlanControlledOperationRequest[]>>({});
    const activeAgentRunIdRef = useRef<string | null>(null);
    const cancelledAgentRunIdsRef = useRef<Set<string>>(new Set());
    const activeAgentRunUiRef = useRef<{
        runId: string;
        conversationId: string | null;
        streamedAssistantMessageId: string | null;
        visibleSteps: ThinkingStep[];
        stopMessageShown: boolean;
    } | null>(null);

    useEffect(() => {
        const nextDraft = externalDraft?.trim();
        if (!nextDraft || externalDraftRevision === undefined) return;
        setInput(nextDraft);
        window.requestAnimationFrame(() => textareaRef.current?.focus());
    }, [externalDraft, externalDraftRevision]);
    
    // 消息编辑状态
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState('');
    
    // 参考图复刻面板状态
    const [showReplicator, setShowReplicator] = useState(false);
    
    // 可见执行反馈状态
    const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
    const [showThinking, setShowThinking] = useState(false);
    const [liveActivity, setLiveActivity] = useState<LiveActivityState | null>(null);
    const composerThinkingModelIds = resolveComposerThinkingModelIds(modelPreferences);
    const composerThinkingPreference = normalizeModelThinkingPreference(modelPreferences?.thinking);
    const canShowThinkingModeToggle = composerThinkingModelIds.length > 0;

    const handleToggleComposerThinking = useCallback(() => {
        const currentPreferences = useAppStore.getState().modelPreferences || modelPreferences;
        const currentThinking = normalizeModelThinkingPreference(currentPreferences?.thinking);
        setModelPreferences({ thinking: { enabled: !currentThinking.enabled } });
    }, [modelPreferences, setModelPreferences]);

    // 输入栏主模型选择器：与设置页「AI 模型 · 主模型」读写同一 store 字段（modelPreferences.primaryModel），
    // 候选口径见 primary-model-options 模块（硬编码 + 持久化动态模型，按运行模式过滤）。
    const composerPrimaryModelId = modelPreferences?.primaryModel || '';
    const composerModelGroups = useMemo(
        () => buildPrimaryModelOptionGroups(modelPreferences?.mode || 'auto', dynamicModels),
        [modelPreferences?.mode, dynamicModels]
    );
    const composerPrimaryModelListed = isModelIdInPrimaryModelOptionGroups(composerModelGroups, composerPrimaryModelId);
    const canShowComposerModelSelect = composerModelGroups.length > 0 || !!composerPrimaryModelId;

    const handleSelectComposerPrimaryModel = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
        const nextModelId = event.target.value.trim();
        if (!nextModelId) return;
        // 只写 store：zustand persist（partialize 含 modelPreferences）负责落盘，
        // App.tsx 的偏好同步 effect 会防抖推送 window.designEcho.setModelPreferences 到主进程
        // （含冷启动回灌），与 Thinking 胶囊同一条同步链路，重启后依然生效。
        setModelPreferences({ primaryModel: nextModelId });
    }, [setModelPreferences]);

    const cachePrivatePublicPlanOperationRequests = useCallback((
        messageId: string | null | undefined,
        request?: AgentTaskPublicPlanExecutionRequest
    ) => {
        if (!messageId) return;
        const runtimeOperationRequests = extractRuntimeOperationRequestsFromPublicPlanExecutionRequest(request);
        if (runtimeOperationRequests.length > 0) {
            publicPlanPrivateOperationRequestsRef.current[messageId] = runtimeOperationRequests;
        } else {
            delete publicPlanPrivateOperationRequestsRef.current[messageId];
        }
    }, []);

    const buildPublicPlanMessagePayload = useCallback(<T extends {
        agentTaskPublicPlanExecutionRequest?: AgentTaskPublicPlanExecutionRequest;
        agentTaskPublicPlanControlledRun?: AgentTaskPublicPlanControlledRun;
    }>(payload: T): T => ({
        ...payload,
        agentTaskPublicPlanExecutionRequest: stripRuntimeParamsFromPublicPlanExecutionRequest(payload.agentTaskPublicPlanExecutionRequest),
        agentTaskPublicPlanControlledRun: stripRuntimeParamsFromPublicPlanControlledRun(payload.agentTaskPublicPlanControlledRun)
    }), []);

    type AddMessageInput = Parameters<typeof addMessage>[0];
    type UpdateMessageInput = Parameters<typeof updateMessage>[1];
    type AssistantMessageWithOriginInput = Omit<AddMessageInput, 'role' | 'assistantReplyOrigin'>;
    type AssistantMessageUpdateWithOriginInput = Omit<UpdateMessageInput, 'role' | 'assistantReplyOrigin'>;

    const addAssistantMessageWithOrigin = useCallback((
        message: AssistantMessageWithOriginInput,
        origin: AssistantReplyOrigin,
        conversationId?: string | null
    ) => {
        const payload = {
            ...message,
            role: 'assistant',
            assistantReplyOrigin: normalizeAssistantReplyOriginForRuntime(
                origin,
                message.content
            )
        } as AddMessageInput;
        return conversationId
            ? addMessageToConversation(conversationId, payload)
            : addMessage(payload);
    }, [addMessage, addMessageToConversation]);

    const updateAssistantMessageWithOrigin = useCallback((
        messageId: string,
        updates: AssistantMessageUpdateWithOriginInput,
        origin: AssistantReplyOrigin,
        conversationId?: string | null
    ) => {
        const payload = {
            ...updates,
            assistantReplyOrigin: normalizeAssistantReplyOriginForRuntime(
                origin,
                updates.content
            )
        } as UpdateMessageInput;
        if (conversationId) {
            updateMessageInConversation(conversationId, messageId, payload);
            return;
        }
        updateMessage(messageId, payload);
    }, [updateMessage, updateMessageInConversation]);

    const addLocalAssistantMessage = useCallback((
        message: AssistantMessageWithOriginInput,
        origin: AssistantReplyOrigin,
        options?: { conversationId?: string | null }
    ) => addAssistantMessageWithOrigin(message, origin, options?.conversationId), [addAssistantMessageWithOrigin]);

    const updateLocalAssistantMessage = useCallback((
        messageId: string,
        updates: AssistantMessageUpdateWithOriginInput,
        origin: AssistantReplyOrigin,
        options?: { conversationId?: string | null }
    ) => updateAssistantMessageWithOrigin(messageId, updates, origin, options?.conversationId), [updateAssistantMessageWithOrigin]);

    const addLocalStatusMessage = useCallback((
        content: string,
        source: string,
        extra?: Omit<AddMessageInput, 'role' | 'assistantReplyOrigin' | 'content'>
    ) => addLocalAssistantMessage({
        ...(extra || {}),
        content
    }, uiStatusReplyOrigin(source)), [addLocalAssistantMessage]);

    const addLocalToolSummaryMessage = useCallback((
        content: string,
        source: string,
        extra?: Omit<AddMessageInput, 'role' | 'assistantReplyOrigin' | 'content'>
    ) => addLocalAssistantMessage({
        ...(extra || {}),
        content
    }, toolSummaryReplyOrigin(source)), [addLocalAssistantMessage]);

    const addLocalBlockerMessage = useCallback((
        content: string,
        source: string,
        extra?: Omit<AddMessageInput, 'role' | 'assistantReplyOrigin' | 'content'>
    ) => addLocalAssistantMessage({
        ...(extra || {}),
        content
    }, deterministicBlockerReplyOrigin(source)), [addLocalAssistantMessage]);

    const isSkuComboEditorCard = (value: unknown): value is SkuComboEditorCard => {
        const card = value && typeof value === 'object' ? value as Partial<SkuComboEditorCard> : {};
        return card.version === 'interactive-card/v0'
            && card.kind === 'sku_combo_editor'
            && card.payload?.version === 'sku-combo-editor/v0';
    };

    const isEditableConfirmationCard = (value: unknown): value is EditableConfirmationCard => {
        const card = value && typeof value === 'object' ? value as Partial<EditableConfirmationCard> : {};
        return card.version === 'interactive-card/v0'
            && card.kind === 'editable_confirmation'
            && card.payload?.version === 'editable-confirmation/v0';
    };

    const formatSkuComboConfirmationText = (
        value: SkuComboEditorValue,
        options?: { colorPrefix?: boolean }
    ): string => {
        const formatCombo = (combo: number[]) => options?.colorPrefix
            ? combo.map((slot) => `颜色${slot}`).join('+')
            : stringifySkuCombo(combo);
        return value.groups
            .map((group) => `${group.size}双：${group.combos.map(formatCombo).join('，')}`)
            .join('；');
    };

    const formatEditableConfirmationText = (
        card: EditableConfirmationCard,
        value: EditableConfirmationValue
    ): string => {
        return card.payload.fields
            .map((field) => {
                const raw = value.values[field.id];
                const rendered = typeof raw === 'boolean' ? (raw ? '是' : '否') : cleanInteractiveCardText(raw);
                return rendered ? `${field.label}：${rendered}` : '';
            })
            .filter(Boolean)
            .join('；');
    };
    
    // === 性能优化：缓存消息渲染回调 ===
    // 用于 MessageRenderer 的 action 处理（稳定引用）
    const handleMessageAction = useCallback((actionId: string, params?: Record<string, any>) => {
        console.log('[ChatPanel] 执行动作:', actionId, params);

        const normalizedActionId = (() => {
            const aliases: Record<string, string> = {
                copy: 'copyText',
                copy_text: 'copyText',
                'copy-to-clipboard': 'copyText',
                copyContent: 'copyText',
                insert_prompt: 'insertPrompt',
                fillInput: 'insertPrompt',
                reusePrompt: 'insertPrompt',
                open_file: 'openProjectFile',
                openFile: 'openProjectFile',
                openDocument: 'openProjectFile',
                switch_document: 'switchDocument',
                activateDocument: 'switchDocument',
                executeTool: 'runTool',
                retryTool: 'runTool',
                retry_tool: 'runTool',
                confirmInteractiveCard: 'submitInteractiveCard',
                submit_interactive_card: 'submitInteractiveCard'
            };
            return aliases[actionId] || actionId;
        })();

        const emitActionResult = (
            status: 'success' | 'failed' | 'skipped' | 'partial' | 'fallback',
            content: string,
            _details?: string,
            source = 'chat-action:result'
        ) => {
            const visibleContent = sanitizeUserVisibleAssistantBodyText(content)
                || sanitizeUserVisibleDiagnosticText(content)
                || '操作状态已更新。';
            if (status === 'skipped') {
                addLocalBlockerMessage(visibleContent, source);
            } else {
                addLocalToolSummaryMessage(visibleContent, source);
            }
        };

        void (async () => {
            try {
                const prepareInteractiveCardSubmission = async (
                    submission: InteractiveCardSubmission,
                    mode: 'record_or_resume' | 'resume_required'
                ): Promise<{
                    mode: 'record_only';
                } | {
                    mode: 'resume_operation';
                    request: InteractiveContinuationRequest;
                    sourceTask: string;
                    conversationId: string;
                    sourceMessageId: string;
                    nextSubmissions: InteractiveCardSubmission[];
                    operationIdentity: InteractiveContinuationOperationIdentity;
                    projectId: string;
                    projectPath: string;
                } | { error: string }> => {
                    const sourceMessageId = String(params?.sourceMessageId || '').trim();
                    const state = useAppStore.getState();
                    if (chatSubmissionInFlightRef.current || state.isLoading) {
                        return { error: '当前已有设计任务正在执行；确认卡尚未消费，请等待完成或先停止当前任务。' };
                    }
                    const conversationId = String(state.currentConversationId || '').trim();
                    const sourceMessage = state.messages.find((message) => message.id === sourceMessageId);
                    const project = state.currentProject;
                    const projectId = String(project?.id || '').trim();
                    const projectPath = String(project?.path || '').trim();
                    const decision = buildInteractiveCardSubmissionDecision({
                        ownerMessage: sourceMessage,
                        submission,
                        mode,
                        ...(conversationId ? { conversationId } : {}),
                        ...(project?.id ? { projectId: String(project.id) } : {}),
                        ...(project?.path ? { projectPath: String(project.path) } : {})
                    });
                    if (decision.status === 'rejected') {
                        return { error: decision.message };
                    }
                    if (!conversationId) {
                        return { error: '当前对话不可用，确认内容尚未提交。' };
                    }
                    if (decision.status === 'record_only') {
                        const recorded = updateMessageInConversation(conversationId, sourceMessageId, {
                            interactiveCardSubmissions: decision.nextSubmissions
                        } as any);
                        if (!recorded) {
                            return { error: '确认记录没有写回来源消息，本轮不会提交。' };
                        }
                        return { mode: 'record_only' };
                    }
                    if (!handleSendRef.current) {
                        return { error: 'Agent 承接入口暂不可用，确认卡尚未消费。' };
                    }
                    const continuation = sourceMessage?.pendingInteractiveContinuation;
                    if (!continuation) {
                        return { error: '原挂起操作已经丢失，确认卡尚未消费。请重新发起任务。' };
                    }
                    const operationIdentity: InteractiveContinuationOperationIdentity = {
                        ...decision.request,
                        conversationId,
                        ...(projectId ? { projectId } : {}),
                        ...(projectPath ? { projectPath } : {})
                    };
                    const ledgerClaim = await claimInteractiveContinuationOperation({
                        ...operationIdentity,
                        submission,
                        continuation,
                        sourceCard: decision.sourceCard
                    });
                    if (!ledgerClaim.success) {
                        return { error: ledgerClaim.message };
                    }
                    const stateAfterClaim = useAppStore.getState();
                    const currentConversationId = String(stateAfterClaim.currentConversationId || '').trim();
                    const currentProjectId = String(stateAfterClaim.currentProject?.id || '').trim();
                    const currentProjectPath = String(stateAfterClaim.currentProject?.path || '').trim();
                    if (
                        currentConversationId !== conversationId
                        || currentProjectId !== projectId
                        || currentProjectPath.toLowerCase() !== projectPath.toLowerCase()
                    ) {
                        return {
                            error: '确认期间对话或项目已经切换；操作仍安全保留，但本轮不会启动。请返回原项目后再次确认。'
                        };
                    }
                    return {
                        mode: 'resume_operation',
                        request: decision.request,
                        sourceTask: decision.sourceTask,
                        conversationId,
                        sourceMessageId,
                        nextSubmissions: decision.nextSubmissions,
                        operationIdentity,
                        projectId,
                        projectPath
                    };
                };

                const finalizeResumedInteractiveCardSubmission = async (decision: {
                    conversationId: string;
                    sourceMessageId: string;
                    nextSubmissions: InteractiveCardSubmission[];
                    operationIdentity: InteractiveContinuationOperationIdentity;
                }): Promise<{
                    committed: boolean;
                    status?: 'succeeded' | 'failed' | 'unknown';
                    message: string;
                }> => {
                    let ledgerState = await getInteractiveContinuationOperation(
                        decision.operationIdentity.continuationId
                    );
                    if (ledgerState.record?.status === 'running') {
                        ledgerState = await markInteractiveContinuationOperationUnknown(
                            decision.operationIdentity.continuationId,
                            'Agent 调用已经返回，但操作账本仍处于 running，无法确认 Photoshop 是否完成写入。'
                        );
                    }
                    const status = ledgerState.record?.status;
                    if (status === 'claimed') {
                        return {
                            committed: false,
                            message: '确认操作尚未开始，卡片保持可重试状态。'
                        };
                    }
                    if (status !== 'succeeded' && status !== 'failed' && status !== 'unknown') {
                        return {
                            committed: false,
                            message: ledgerState.message || '无法读取确认操作终态，卡片不会被标记为完成。'
                        };
                    }
                    let executionMessage = '原确认操作已完成。';
                    if (status === 'failed') {
                        executionMessage = ledgerState.record?.outcomeSummary
                            || '操作在 Photoshop 写入前校验失败，未开始写入；可以重新发起任务。';
                    } else if (status === 'unknown') {
                        executionMessage = ledgerState.record?.uncertaintyReason
                            || '执行状态不确定，请先检查 Photoshop；系统不会自动重放。';
                    }
                    const projectedSubmissions = decision.nextSubmissions.map((submission) => {
                        if (submission.cardId !== decision.operationIdentity.cardId) return submission;
                        return {
                            ...submission,
                            execution: {
                                status,
                                message: executionMessage
                            }
                        };
                    });
                    const committed = updateMessageInConversation(decision.conversationId, decision.sourceMessageId, {
                        interactiveCardSubmissions: projectedSubmissions
                    } as any);
                    return {
                        committed,
                        status,
                        message: executionMessage
                    };
                };

                switch (normalizedActionId) {
                    case 'copyText': {
                        const text = String(
                            params?.text ??
                            params?.value ??
                            params?.content ??
                            params?.summary ??
                            params?.payload?.text ??
                            ''
                        ).trim();
                        if (!text) {
                            emitActionResult('skipped', '没有可复制的内容。', 'text empty', 'ui.copyText');
                            return;
                        }
                        await navigator.clipboard.writeText(text);
                        emitActionResult('success', '已复制到剪贴板。', `length=${text.length}`, 'ui.copyText');
                        return;
                    }
                    case 'insertPrompt': {
                        const prompt = String(
                            params?.prompt ??
                            params?.text ??
                            params?.payload?.prompt ??
                            ''
                        ).trim();
                        if (!prompt) {
                            emitActionResult('skipped', '未提供可插入的内容。', 'prompt empty', 'ui.insertPrompt');
                            return;
                        }
                        setInput(prompt);
                        emitActionResult('success', '已填入输入框。', `length=${prompt.length}`, 'ui.insertPrompt');
                        return;
                    }
                    case 'openProjectFile': {
                        const query = String(
                            params?.query ??
                            params?.fileName ??
                            params?.name ??
                            params?.path ??
                            params?.payload?.query ??
                            ''
                        ).trim();
                        if (!query) {
                            emitActionResult('skipped', '缺少要打开的文件关键词。', 'query empty', 'openProjectFile');
                            return;
                        }
                        const result = await executeToolCall('openProjectFile', {
                            query,
                            type: params?.type || params?.payload?.type || 'all',
                            directory: params?.directory || params?.payload?.directory
                        });
                        if (result?.success) {
                            emitActionResult('success', `已尝试打开文件：${query}`, 'openProjectFile success', 'openProjectFile');
                        } else {
                            emitActionResult('failed', formatUserVisibleFailureContent('打开文件失败', result?.error), result?.error || 'openProjectFile failed', 'openProjectFile');
                        }
                        return;
                    }
                    case 'switchDocument': {
                        const documentName = String(
                            params?.documentName ??
                            params?.name ??
                            params?.query ??
                            params?.payload?.documentName ??
                            ''
                        ).trim();
                        if (!documentName) {
                            emitActionResult('skipped', '缺少文档名称。', 'documentName empty', 'switchDocument');
                            return;
                        }
                        const result = await executeToolCall('switchDocument', { documentName });
                        if (result?.success) {
                            emitActionResult('success', `已切换到文档：${documentName}`, 'switchDocument success', 'switchDocument');
                        } else {
                            emitActionResult('failed', formatUserVisibleFailureContent('切换文档失败', result?.error), result?.error || 'switchDocument failed', 'switchDocument');
                        }
                        return;
                    }
                    case 'runTool': {
                        const toolName = String(
                            params?.toolName ??
                            params?.tool ??
                            params?.retryTool ??
                            params?.name ??
                            params?.payload?.toolName ??
                            ''
                        ).trim();
                        if (!toolName) {
                            emitActionResult('skipped', '未指定要执行的操作。', 'toolName empty', 'runTool');
                            return;
                        }
                        const rawToolParams = (
                            params?.toolParams ??
                            params?.params ??
                            params?.payload?.toolParams ??
                            params?.payload?.params ??
                            {}
                        ) as Record<string, any>;
                        const toolParams = sanitizeUiActionToolParams(rawToolParams) as Record<string, any>;
                        const result = await executeToolCall(toolName, toolParams);
                        if (result?.success) {
                            emitActionResult('success', '操作已完成。', result?.message || 'runTool success', `tool:${toolName}`);
                        } else {
                            const code = result?.code ? `code=${result.code}` : '';
                            const err = result?.error || 'runTool failed';
                            emitActionResult('failed', formatUserVisibleFailureContent('操作失败', result?.error), [err, code].filter(Boolean).join(' | '), `tool:${toolName}`);
                        }
                        return;
                    }
                    case 'submitVisualObservationCard': {
                        const action = String((params?.value as { actionId?: string } | undefined)?.actionId || '');
                        const sourceCard = params?.card as VisualObservationBlockedCard | undefined;
                        if (!sourceCard) {
                            emitActionResult('skipped', '卡片数据缺失，请重新生成。', 'missing card', 'ui.submitVisualObservationCard');
                            return;
                        }
                        //  卡片动作走确定性控制器：直接得结果，绝不重入发送管线（不插用户消息/不重进 Thinking/不重跑 v5）
                        const cardResult = submitVisualObservationCardAction(sourceCard, action);
                        if (cardResult.type === 'card') {
                            addLocalAssistantMessage(
                                {
                                    content: '',
                                    interactiveCards: [cardResult.card as unknown as InteractiveCardDefinition],
                                    isThinking: false
                                },
                                uiStatusReplyOrigin('v5:structure-skeleton')
                            );
                            return;
                        }
                        emitActionResult('skipped', cardResult.message, cardResult.code, 'ui.submitVisualObservationCard');
                        return;
                    }
                    case 'submitSkuHumanReviewCard': {
                        const card = params?.card;
                        if (!isSkuHumanReviewCard(card)) {
                            emitActionResult('skipped', 'SKU 复核卡片数据已失效，请重新生成。', 'invalid sku human review card', 'ui.submitSkuHumanReviewCard');
                            return;
                        }
                        if (submittedSkuHumanReviewCardIds.has(card.id)) {
                            emitActionResult('skipped', '这批 SKU 结果已经提交过复核，请勿重复写入。', 'sku-human-review-card-already-submitted', 'ui.submitSkuHumanReviewCard');
                            return;
                        }
                        const validation = validateSkuHumanReviewCardValue(card.payload, params?.value);
                        if (!validation.canSubmit) {
                            emitActionResult(
                                'skipped',
                                validation.blockers.slice(0, 4).join('\n') || '人工复核信息还不完整。',
                                'sku human review validation failed',
                                'ui.submitSkuHumanReviewCard'
                            );
                            return;
                        }
                        const intake = buildSkuHumanReviewIntakeFromCard({
                            card,
                            value: validation.normalizedValue
                        });
                        try {
                            const record = getMemoryService().recordHumanReview({
                                projectId: card.payload.target.projectFingerprint,
                                intake
                            });
                            submittedSkuHumanReviewCardIds.add(card.id);
                            const submission = buildInteractiveCardSubmission({
                                card,
                                value: validation.normalizedValue,
                                validation
                            });
                            addLocalToolSummaryMessage(
                                [
                                    `已写入当前 SKU 批次的人工复核：${record.statusLabel}。`,
                                    `复核人：${record.review.reviewer || '未填写'}。`,
                                    '该结论只对当前导出文件内容哈希有效；文件发生变化后会自动失效。'
                                ].join('\n'),
                                'interactive-card:sku-human-review-recorded',
                                { interactiveCardSubmissions: [submission] } as any
                            );
                        } catch (error: any) {
                            emitActionResult(
                                'failed',
                                `SKU 人工复核写入失败：${cleanInteractiveCardText(error?.message) || '本地台账不可用'}`,
                                'sku human review persistence failed',
                                'ui.submitSkuHumanReviewCard'
                            );
                        }
                        return;
                    }
                    case 'submitDesignProjectRuleReviewCard': {
                        const card = params?.card;
                        if (!isDesignProjectRuleReviewCard(card)) {
                            emitActionResult('skipped', '项目规则复核卡片已失效，请重新读取项目状态。', 'invalid design project rule review card', 'ui.submitDesignProjectRuleReviewCard');
                            return;
                        }
                        if (submittedDesignProjectRuleReviewCardIds.has(card.id)) {
                            emitActionResult('skipped', '这张项目规则复核卡已经提交过，请勿重复写入。', 'design-project-rule-review-already-submitted', 'ui.submitDesignProjectRuleReviewCard');
                            return;
                        }
                        const validation = validateDesignProjectRuleReviewCardValue(card.payload, params?.value);
                        if (!validation.canSubmit) {
                            emitActionResult('skipped', validation.blockers.slice(0, 4).join('\n') || '规则复核内容没有通过检查。', 'design-project-rule-review-validation-failed', 'ui.submitDesignProjectRuleReviewCard');
                            return;
                        }
                        const projectPath = useAppStore.getState().currentProject?.path;
                        const designEcho = (window as any).designEcho;
                        if (!projectPath || typeof designEcho?.getDesignState !== 'function' || typeof designEcho?.updateDesignState !== 'function') {
                            emitActionResult('failed', '项目规则复核写入失败：当前项目状态服务不可用。', 'design state service unavailable', 'ui.submitDesignProjectRuleReviewCard');
                            return;
                        }
                        try {
                            const current = await designEcho.getDesignState(projectPath);
                            if (!current?.success || !doesDesignProjectRuleReviewCardMatchState({ card, state: current.state, projectIdentity: projectPath })) {
                                emitActionResult('skipped', '项目规则在复核期间已经变化，请重新读取后再确认。', 'design-project-rule-review-stale', 'ui.submitDesignProjectRuleReviewCard');
                                return;
                            }
                            const updated = await designEcho.updateDesignState(projectPath, buildDesignProjectRuleReviewPatch({
                                card,
                                value: validation.normalizedValue
                            }));
                            if (!updated?.success) throw new Error(updated?.error || '项目状态没有返回成功结果');
                            submittedDesignProjectRuleReviewCardIds.add(card.id);
                            const submission = buildInteractiveCardSubmission({ card, value: validation.normalizedValue, validation });
                            addLocalToolSummaryMessage(
                                [
                                    '项目与品牌规则复核结论已写入。',
                                    getDesignProjectRuleReviewCardSummary(updated.state),
                                    '规则只约束质量和交付判断，不会授予 Photoshop 或外部动作权限。'
                                ].join('\n'),
                                'interactive-card:design-project-rule-review-recorded',
                                { interactiveCardSubmissions: [submission] } as any
                            );
                        } catch (error: any) {
                            emitActionResult('failed', `项目规则复核写入失败：${cleanInteractiveCardText(error?.message) || '本地项目状态不可用'}`, 'design project rule review persistence failed', 'ui.submitDesignProjectRuleReviewCard');
                        }
                        return;
                    }
                    case 'submitDesignProjectFactReviewCard': {
                        const card = params?.card;
                        if (!isDesignProjectFactReviewCard(card)) {
                            emitActionResult('skipped', '项目事实复核卡片已失效，请重新读取项目状态。', 'invalid design project fact review card', 'ui.submitDesignProjectFactReviewCard');
                            return;
                        }
                        if (submittedDesignProjectFactReviewCardIds.has(card.id)) {
                            emitActionResult('skipped', '这张项目事实复核卡已经提交过，请勿重复写入。', 'design-project-fact-review-already-submitted', 'ui.submitDesignProjectFactReviewCard');
                            return;
                        }
                        const validation = validateDesignProjectFactReviewCardValue(card.payload, params?.value);
                        if (!validation.canSubmit) {
                            emitActionResult(
                                'skipped',
                                validation.blockers.slice(0, 4).join('\n') || '项目事实复核信息不完整。',
                                'design project fact review validation failed',
                                'ui.submitDesignProjectFactReviewCard'
                            );
                            return;
                        }
                        const projectPath = useAppStore.getState().currentProject?.path;
                        const designEcho = (window as any).designEcho;
                        if (!projectPath || typeof designEcho?.getDesignState !== 'function' || typeof designEcho?.updateDesignState !== 'function') {
                            emitActionResult('failed', '项目事实复核写入失败：当前项目状态服务不可用。', 'design state service unavailable', 'ui.submitDesignProjectFactReviewCard');
                            return;
                        }
                        try {
                            const current = await designEcho.getDesignState(projectPath);
                            if (
                                current?.success !== true
                                || !doesDesignProjectFactReviewCardMatchState({
                                    card,
                                    state: current.state,
                                    projectIdentity: projectPath
                                })
                            ) {
                                emitActionResult('skipped', '项目事实在复核期间已经变化，请重新读取后再确认。', 'design-project-fact-review-stale', 'ui.submitDesignProjectFactReviewCard');
                                return;
                            }
                            const patch = buildDesignProjectFactReviewPatch({
                                card,
                                value: validation.normalizedValue
                            });
                            const updated = await designEcho.updateDesignState(projectPath, patch);
                            if (updated?.success !== true) {
                                throw new Error(updated?.error || '项目状态没有返回成功结果');
                            }
                            submittedDesignProjectFactReviewCardIds.add(card.id);
                            const submission = buildInteractiveCardSubmission({
                                card,
                                value: validation.normalizedValue,
                                validation
                            });
                            addLocalToolSummaryMessage(
                                [
                                    '项目事实复核结论已写入。',
                                    getDesignProjectFactReviewCardSummary(updated.state),
                                    '未确认、已驳回或已被取代的事实不会用于通过设计质量检查。'
                                ].join('\n'),
                                'interactive-card:design-project-fact-review-recorded',
                                { interactiveCardSubmissions: [submission] } as any
                            );
                        } catch (error: any) {
                            emitActionResult(
                                'failed',
                                `项目事实复核写入失败：${cleanInteractiveCardText(error?.message) || '本地项目状态不可用'}`,
                                'design project fact review persistence failed',
                                'ui.submitDesignProjectFactReviewCard'
                            );
                        }
                        return;
                    }
                    case 'submitInteractiveCard': {
                        const card = params?.card;
                        if (isEditableConfirmationCard(card)) {
                            const validation = validateEditableConfirmationValue(card.payload, params?.value);
                            if (!validation.canSubmit) {
                                emitActionResult(
                                    'skipped',
                                    validation.blockers.slice(0, 4).join('\n') || '内容还没有通过检查，请先修改。',
                                    'interactive card validation failed',
                                    'ui.submitInteractiveCard'
                                );
                                return;
                            }

                            const memoryCandidate = card.memoryPolicy?.enabled
                                ? buildEditableConfirmationApprovedMemory({
                                    card,
                                    value: validation.normalizedValue,
                                    scope: card.memoryPolicy.scope,
                                    confirmedBy: 'user'
                                })
                                : undefined;
                            const submission = buildInteractiveCardSubmission({
                                card,
                                value: validation.normalizedValue,
                                validation,
                                memoryCandidate
                            });
                            const decision = await prepareInteractiveCardSubmission(submission, 'record_or_resume');
                            if ('error' in decision) {
                                emitActionResult('skipped', decision.error, 'interactive card submission rejected', 'ui.submitInteractiveCard');
                                return;
                            }
                            let memoryId = '';
                            let memoryError = '';
                            if (memoryCandidate) {
                                try {
                                    memoryId = getMemoryService().recordUserConfirmedDesignMemoryItem(memoryCandidate).id;
                                } catch (error: any) {
                                    memoryError = cleanInteractiveCardText(error?.message) || '记忆保存失败';
                                }
                            }
                            const confirmationText = formatEditableConfirmationText(card, validation.normalizedValue);
                            addLocalToolSummaryMessage(
                                [
                                    `已确认：${card.title}`,
                                    confirmationText,
                                    memoryId ? '已保存为可复用内容。' : '',
                                    memoryError ? `内容已确认，但记忆没有保存：${memoryError}` : ''
                                ].filter(Boolean).join('\n'),
                                'interactive-card:editable-confirmed'
                            );
                            if (decision.mode === 'resume_operation') {
                                const send = handleSendRef.current;
                                if (!send) {
                                    throw new Error('Agent 承接入口暂不可用，确认操作仍保留在执行账本中。');
                                }
                                await send({
                                    text: decision.sourceTask,
                                    interactiveContinuationRequest: decision.request,
                                    expectedConversationId: decision.conversationId,
                                    expectedProjectId: decision.projectId,
                                    expectedProjectPath: decision.projectPath
                                });
                                const finalization = await finalizeResumedInteractiveCardSubmission(decision);
                                if (!finalization.committed || finalization.status !== 'succeeded') {
                                    addLocalBlockerMessage(
                                        finalization.message,
                                        'interactive-card:submission-state-save-failed'
                                    );
                                }
                            }
                            return;
                        }
                        if (!isSkuComboEditorCard(card)) {
                            emitActionResult('skipped', '这张确认卡片暂时不能提交，请重新生成。', 'unsupported interactive card', 'ui.submitInteractiveCard');
                            return;
                        }
                        const validation = validateSkuComboEditorValue(card.payload, params?.value);
                        if (!validation.canSubmit) {
                            emitActionResult(
                                'skipped',
                                validation.blockers.slice(0, 4).join('\n') || '组合还没有通过检查，请先修改。',
                                'interactive card validation failed',
                                'ui.submitInteractiveCard'
                            );
                            return;
                        }

                        const memoryCandidate = card.memoryPolicy?.enabled
                            ? buildSkuComboApprovedRecipeMemory({
                                card,
                                value: validation.normalizedValue,
                                scope: card.memoryPolicy.scope,
                                confirmedBy: 'user'
                            })
                            : undefined;
                        const submission = buildInteractiveCardSubmission({
                            card,
                            value: validation.normalizedValue,
                            validation,
                            memoryCandidate
                        });
                        const decision = await prepareInteractiveCardSubmission(submission, 'resume_required');
                        if ('error' in decision) {
                            emitActionResult('skipped', decision.error, 'interactive continuation claim rejected', 'ui.submitInteractiveCard');
                            return;
                        }
                        if (decision.mode !== 'resume_operation') {
                            emitActionResult(
                                'skipped',
                                'SKU 确认卡没有绑定可恢复操作，本轮不会执行。请重新发起 SKU 任务。',
                                'sku interactive continuation missing',
                                'ui.submitInteractiveCard'
                            );
                            return;
                        }
                        let memoryId = '';
                        let memoryError = '';
                        if (memoryCandidate) {
                            try {
                                memoryId = getMemoryService().recordUserConfirmedDesignMemoryItem(memoryCandidate).id;
                            } catch (error: any) {
                                memoryError = cleanInteractiveCardText(error?.message) || '记忆保存失败';
                            }
                        }
                        const comboText = formatSkuComboConfirmationText(validation.normalizedValue);
                        addLocalToolSummaryMessage(
                            [
                                `已确认 SKU 组合：${comboText}`,
                                memoryId ? `已保存为可复用配方。` : '',
                                memoryError ? `组合已确认，但配方记忆没有保存：${memoryError}` : ''
                                ].filter(Boolean).join('\n'),
                            'interactive-card:sku-combo-confirmed'
                        );
                        const send = handleSendRef.current;
                        if (!send) {
                            throw new Error('Agent 承接入口暂不可用，确认操作仍保留在执行账本中。');
                        }
                        await send({
                            text: decision.sourceTask,
                            interactiveContinuationRequest: decision.request,
                            expectedConversationId: decision.conversationId,
                            expectedProjectId: decision.projectId,
                            expectedProjectPath: decision.projectPath
                        });
                        const finalization = await finalizeResumedInteractiveCardSubmission(decision);
                        if (!finalization.committed || finalization.status !== 'succeeded') {
                            addLocalBlockerMessage(
                                finalization.message,
                                'interactive-card:sku-submission-state-save-failed'
                            );
                        }
                        return;
                    }
                    case 'submitDestructiveActionCard': {
                        // V1-7b 正版 HITL 确定性重放：点卡后由确定性控制器直接得结果，绝不重入模型轮生成调用
                        // ——重放的必是卡片暂存的原始调用（红线 B）。
                        const card = params?.card as PendingDestructiveActionCard | undefined;
                        const actionId = String((params?.value as { actionId?: string } | undefined)?.actionId || '');
                        const submission = resolvePendingDestructiveActionSubmission(card, actionId);
                        if (submission.type === 'rejected') {
                            emitActionResult('skipped', submission.message, submission.code, 'ui.submitDestructiveActionCard');
                            return;
                        }
                        // 幂等：一张卡只处理一次（execute/cancel 均消费），防重复点击=重复重放（浏览器 click 重复=重复下单/支付）。
                        const destructiveCardId = submission.card.id;
                        if (submittedDestructiveActionCardIds.has(destructiveCardId)) {
                            emitActionResult('skipped', '这个操作已经处理过了，请勿重复点击。', 'destructive-card-already-resolved', 'ui.submitDestructiveActionCard');
                            return;
                        }
                        submittedDestructiveActionCardIds.add(destructiveCardId);
                        if (submission.type === 'cancelled') {
                            addLocalToolSummaryMessage(
                                `已取消该操作：${submission.card.payload.targetSummary}`,
                                'interactive-card:destructive-cancelled'
                            );
                            // 干净续跑：告知模型该动作未获批准，改用其他不破坏的方式（不执行任何破坏性动作）
                            await handleSendRef.current?.({
                                text: `我不批准这个操作：${submission.card.payload.targetSummary}。请不要执行它，改用其他不破坏的方式继续。`
                            });
                            return;
                        }
                        // submission.type === 'execute'：确定性重放暂存的原始调用（已注入确认参数），走直连执行路径
                        const replayResult = await executeToolCall(submission.toolName, submission.params);
                        if (replayResult?.success !== false) {
                            addLocalToolSummaryMessage(
                                `已确认并执行：${submission.card.payload.targetSummary}`,
                                'interactive-card:destructive-executed'
                            );
                            await handleSendRef.current?.({
                                text: `我已确认并执行了这个操作：${submission.card.payload.targetSummary}。请基于执行结果继续后续步骤，不要重复执行它。`
                            });
                        } else {
                            emitActionResult('failed', formatUserVisibleFailureContent('操作执行失败', replayResult?.error), replayResult?.error || 'destructive replay failed', `tool:${submission.toolName}`);
                            await handleSendRef.current?.({
                                text: `我确认执行了这个操作但失败了：${submission.card.payload.targetSummary}（${replayResult?.error || '未知错误'}）。请判断如何继续，不要盲目重试同一操作。`
                            });
                        }
                        return;
                    }
                    case 'confirmPublicPlan': {
                        const sourceMessageId = String(
                            params?.sourceMessageId ??
                            params?.messageId ??
                            params?.payload?.sourceMessageId ??
                            ''
                        ).trim();
                        const sourceMessage = useAppStore.getState().messages
                            .find(message => message.id === sourceMessageId) as any;
                        const request = sourceMessage?.agentTaskPublicPlanExecutionRequest;
                        if (!sourceMessageId || request?.status !== 'blocked_pending_user_confirmation') {
                            emitActionResult('skipped', '这条计划已经不可确认，请重新生成计划。', 'public plan request missing or not pending', 'ui.confirmPublicPlan');
                            return;
                        }
                        const runtimeOperationRequests = publicPlanPrivateOperationRequestsRef.current[sourceMessageId];
                        const shouldUseDisposableLiveAdapter = Array.isArray(runtimeOperationRequests)
                            && runtimeOperationRequests.some(operation => (
                                operation?.toolName === 'createDocument'
                                || operation?.toolName === 'renderLayout'
                            ));
                        await handleSendRef.current?.({
                            text: '确认计划',
                            publicPlanConfirmationSourceMessageId: sourceMessageId,
                            publicPlanDisposableLiveAdapter: shouldUseDisposableLiveAdapter
                        });
                        return;
                    }
                    default:
                        emitActionResult('skipped', '这个界面动作暂时不可用。', `unsupported action: ${actionId}`, `ui.${normalizedActionId}`);
                        return;
                }
            } catch (error: any) {
                emitActionResult('failed', formatUserVisibleFailureContent('动作执行失败', error), error?.message || 'action exception', `ui.${normalizedActionId}`);
            }
        })();
    }, [addMessage]);
    
    // 可见执行反馈辅助函数
    const addThinkingStep = (step: Omit<ThinkingStep, 'id' | 'timestamp'>) => {
        const newStep: ThinkingStep = {
            ...step,
            id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now()
        };
        setThinkingSteps(prev => [...prev, newStep]);
        return newStep.id;
    };
    
    const updateThinkingStep = (stepId: string, updates: Partial<ThinkingStep>) => {
        setThinkingSteps(prev => prev.map(step => 
            step.id === stepId ? { ...step, ...updates } : step
        ));
    };
    
    const clearThinkingSteps = (hideThinking: boolean = true) => {
        setThinkingSteps([]);
        setLiveActivity(null);
        if (hideThinking) {
            setShowThinking(false);
        }
    };

    const finalizeAgentRunStopped = (
        runId: string,
        source: string,
        resultProjection?: {
            executionSummary?: AgentExecutionSummary;
            agentTaskPlanPresentation?: AgentTaskPlanPresentation;
        }
    ): boolean => {
        const ui = activeAgentRunUiRef.current;
        if (!ui || ui.runId !== runId) return false;

        cancelledAgentRunIdsRef.current.add(runId);
        const preservedSteps = normalizeStoppedVisibleProcessSteps(ui.visibleSteps);
        const interruption = buildUserStoppedResponseInterruption();
        const resultProjectionUpdate: UpdateMessageInput = {
            ...(resultProjection?.executionSummary
                ? { executionSummary: resultProjection.executionSummary }
                : {}),
            ...(resultProjection?.agentTaskPlanPresentation
                ? { agentTaskPlanPresentation: resultProjection.agentTaskPlanPresentation }
                : {})
        };
        const terminalUpdate: UpdateMessageInput = {
            isThinking: false,
            agentResponseInterruption: interruption,
            ...(preservedSteps ? { thinkingSteps: preservedSteps } : {}),
            ...resultProjectionUpdate
        };
        const state = useAppStore.getState();
        const targetConversationId = ui.conversationId || state.currentConversationId;
        const targetConversationExists = Boolean(
            targetConversationId
            && state.conversations.some((conversation) => conversation.id === targetConversationId)
        );
        let didPresentTerminalState = false;

        if (ui.stopMessageShown) {
            if (!ui.streamedAssistantMessageId || !targetConversationId || !resultProjection) return false;
            didPresentTerminalState = updateMessageInConversation(
                targetConversationId,
                ui.streamedAssistantMessageId,
                resultProjectionUpdate
            );
            if (didPresentTerminalState) useAppStore.getState().saveCurrentProjectConversations();
            return didPresentTerminalState;
        }

        if (ui.streamedAssistantMessageId && targetConversationId) {
            // 保留模型已经输出的正文和 model_authored 来源，只附加 Harness 拥有的停止终态。
            didPresentTerminalState = updateMessageInConversation(
                targetConversationId,
                ui.streamedAssistantMessageId,
                terminalUpdate
            );
        } else if (targetConversationId && targetConversationExists) {
            // 尚无正文时也落一条结构化、可渲染的停止终态；不再依赖 Thinking 是否会被 parser 保留。
            ui.streamedAssistantMessageId = addLocalAssistantMessage({
                content: '',
                isThinking: false,
                agentResponseInterruption: interruption,
                ...(preservedSteps ? { thinkingSteps: preservedSteps } : {}),
                ...resultProjectionUpdate
            }, uiStatusReplyOrigin(source), { conversationId: targetConversationId });
            didPresentTerminalState = true;
        }

        if (!didPresentTerminalState) {
            console.warn('[ChatPanel] 用户停止终态未写入：目标会话或流式消息已不存在', {
                runId,
                conversationId: targetConversationId,
                streamedAssistantMessageId: ui.streamedAssistantMessageId
            });
            clearThinkingSteps();
            return false;
        }

        // 停止终态属于用户刚触发的关键生命周期事实，不能等待普通消息的 2 秒防抖保存。
        useAppStore.getState().saveCurrentProjectConversations();
        ui.stopMessageShown = true;
        clearThinkingSteps();
        return true;
    };

    const markActiveAgentRunStopped = () => {
        const runId = activeAgentRunIdRef.current;
        if (!runId) return;
        finalizeAgentRunStopped(runId, 'agent-run:user-stopped');
    };

    /**
     * 开始编辑消息
     * 使用 useCallback 避免子组件不必要的重渲染
     */
    const handleStartEdit = useCallback((messageId: string, content: string) => {
        setEditingMessageId(messageId);
        setEditingContent(content);
    }, []);

    /**
     * 取消编辑
     */
    const handleCancelEdit = useCallback(() => {
        setEditingMessageId(null);
        setEditingContent('');
    }, []);

    /**
     * 确认编辑并重新发送
     */
    const handleConfirmEdit = async () => {
        if (!editingMessageId || !editingContent.trim()) return;
        
        // 删除该消息及其后续消息
        removeMessagesFrom(editingMessageId);
        
        // 重置编辑状态
        const newContent = editingContent;
        setEditingMessageId(null);
        setEditingContent('');
        
        // 将编辑后的内容作为新消息发送
        addMessage({ role: 'user', content: newContent });
        
        // 使用统一 Agent 处理
        setLoading(true);
        try {
            await handleUnifiedAgent(newContent);
        } finally {
            setLoading(false);
        }
    };

    // 自动滚动到底部
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // 自动调整输入框高度
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
        }
    }, [input]);

    const handleApplySuggestion = async (suggestion: TextSuggestion) => {
        if (!window.designEcho) return;
        
        try {
            // 1. 设置文本内容
            await window.designEcho.sendToPlugin('setTextContent', { 
                content: suggestion.text 
            });

            // 2. 设置文本样式 (如果建议中有)
            const styleParams: Record<string, any> = {};
            
            if (suggestion.design.suggestedFontSize) {
                styleParams.fontSize = typeof suggestion.design.suggestedFontSize === 'number' 
                        ? suggestion.design.suggestedFontSize 
                    : parseFloat(suggestion.design.suggestedFontSize as string);
            }

            // 解析字间距（如 "+2%" 转换为 tracking 值）
            if (suggestion.design.suggestedLetterSpacing) {
                const spacing = suggestion.design.suggestedLetterSpacing;
                const match = spacing.match(/([+-]?\d+(?:\.\d+)?)\s*%?/);
                if (match) {
                    // 将百分比转换为 tracking 值（千分之一 em）
                    // 1% ≈ 10 tracking 单位
                    styleParams.tracking = parseFloat(match[1]) * 10;
                }
            }

            // 设置行高
            if (suggestion.design.suggestedLineHeight) {
                // lineHeight 是倍数，需要乘以字号得到 leading 值
                const fontSize = styleParams.fontSize || 12;
                styleParams.leading = suggestion.design.suggestedLineHeight * fontSize;
            }

            if (Object.keys(styleParams).length > 0) {
                await window.designEcho.sendToPlugin('setTextStyle', styleParams);
            }

            addLocalAssistantMessage({
                content: `✅ 已应用方案：${suggestion.text}`
            }, toolSummaryReplyOrigin('layout-suggestion:apply'));

        } catch (error) {
            addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('应用失败', error)
            }, toolSummaryReplyOrigin('layout-suggestion:apply-failed'));
        }
    };

    /**
     * 应用单个排版修复
     */
    const handleApplyLayoutFix = async (fix: LayoutFix): Promise<void> => {
        if (!window.designEcho) return;

        try {
            console.log('[ChatPanel] 应用修复:', fix);
            
            switch (fix.action) {
                case 'move':
                    // 映射 left/top 到 x/y (moveLayer 工具使用 x, y 参数)
                    const moveParams = {
                        layerId: fix.layerId,
                        x: fix.changes.left ?? fix.changes.x ?? 0,
                        y: fix.changes.top ?? fix.changes.y ?? 0,
                        relative: false  // 使用绝对位置
                    };
                    console.log('[ChatPanel] moveLayer 参数:', moveParams);
                    const moveResult = await window.designEcho.sendToPlugin('moveLayer', moveParams);
                    console.log('[ChatPanel] moveLayer 结果:', moveResult);
                    if (!moveResult.success) {
                        throw new Error(moveResult.error || '移动图层失败');
                    }
                    break;
                
                case 'restyle':
                    const restyleResult = await window.designEcho.sendToPlugin('setTextStyle', {
                        layerId: fix.layerId,
                        ...fix.changes
                    });
                    console.log('[ChatPanel] setTextStyle 结果:', restyleResult);
                    if (!restyleResult.success) {
                        throw new Error(restyleResult.error || '设置样式失败');
                    }
                    break;
                
                case 'align':
                    const alignResult = await window.designEcho.sendToPlugin('alignLayers', {
                        layerIds: [fix.layerId],
                        alignType: fix.changes.alignType || 'center'
                    });
                    console.log('[ChatPanel] alignLayers 结果:', alignResult);
                    if (!alignResult.success) {
                        throw new Error(alignResult.error || '对齐失败');
                    }
                    break;
                
                default:
                    console.warn('Unknown fix action:', fix.action);
            }
        } catch (error) {
            console.error('[ChatPanel] 应用修复失败:', error);
            throw new Error(`应用修复失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    };

    /**
     * 批量应用排版修复
     */
    const handleApplyAllLayoutFixes = async (fixes: LayoutFix[]): Promise<void> => {
        for (const fix of fixes) {
            await handleApplyLayoutFix(fix);
        }
        
        addLocalAssistantMessage({
            content: `✅ 已应用 ${fixes.length} 项排版修复`
        }, toolSummaryReplyOrigin('layout-fix:apply-all'));
    };

    const handleOptimize = async () => {
        if (!isPluginConnected) {
            addLocalBlockerMessage('⚠️ 请先连接 Photoshop 插件', 'text-optimize:photoshop-disconnected');
            return;
        }

        setLoading(true);

        try {
            const result = await window.designEcho.sendToPlugin('getTextContent', {});
            if (!result.success) {
                throw new Error(result.error || '获取文本失败');
            }
            const currentText = result.content;

            await window.designEcho.sendToPlugin('getTextStyle', {});

            const aiResponse = await window.designEcho.executeTask('text-optimize', {
                text: currentText
            });

            // 3. 解析结果
            let suggestions: TextSuggestion[] = [];
            if (aiResponse.suggestions) {
                suggestions = aiResponse.suggestions;
            } else {
                // 尝试从文本解析 JSON
                // 实际生产中应该由 TaskOrchestrator 保证返回 JSON
                console.warn('AI response format warning:', aiResponse);
                if (typeof aiResponse === 'string') {
                    // 简单的尝试解析
                    try {
                        const jsonMatch = aiResponse.match(/```json\n?([\s\S]*?)\n?```/);
                        if (jsonMatch) {
                             const parsed = JSON.parse(jsonMatch[1]);
                             if (parsed.suggestions) suggestions = parsed.suggestions;
                        }
                    } catch (e) {
                        console.error('Failed to parse response manually', e);
                    }
                }
            }

            // 4. 展示结果
            if (suggestions.length > 0) {
                addLocalToolSummaryMessage('✨ 优化建议如下：', 'legacy-task:text-optimize', {
                    suggestions: suggestions
                });
            } else {
                addLocalStatusMessage('🤔 AI 未能生成有效建议，请重试。', 'legacy-task:text-optimize:empty');
            }

        } catch (error) {
            console.error('Optimize error:', error);
            addLocalToolSummaryMessage(
                formatUserVisibleFailureContent('优化失败', error),
                'legacy-task:text-optimize:failed'
            );
        } finally {
            setLoading(false);
        }
    };

    /**
     * 处理粘贴事件 - 支持 Ctrl+V 粘贴图片
     */
    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            // 检查是否为图片类型
            if (item.type.startsWith('image/')) {
                e.preventDefault();  // 阻止默认粘贴行为
                
                const file = item.getAsFile();
                if (!file) continue;
                
                // 读取图片为 base64
                const reader = new FileReader();
                reader.onload = (event) => {
                    const result = event.target?.result as string;
                    if (result) {
                        // 提取 base64 数据（去掉 data:image/xxx;base64, 前缀）
                        const base64Data = result.split(',')[1];
                        const imageType = item.type;
                        
                        setPastedImage({
                            data: base64Data,
                            type: imageType
                        });
                        
                        console.log(`[ChatPanel] 📷 已粘贴图片: ${imageType}, 大小: ${(base64Data.length / 1024).toFixed(1)}KB`);
                    }
                };
                reader.readAsDataURL(file);
                break;  // 只处理第一张图片
            }
        }
    };

    /**
     * 处理拖拽进入事件
     */
    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 检查是否拖拽的是文件
        if (e.dataTransfer?.types.includes('Files')) {
            setIsDraggingImage(true);
        }
    };

    /**
     * 处理拖拽悬停事件
     */
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    /**
     * 处理拖拽离开事件
     */
    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 检查是否真的离开了输入区域（而不是进入子元素）
        const rect = inputAreaRef.current?.getBoundingClientRect();
        if (rect) {
            const { clientX, clientY } = e;
            if (
                clientX < rect.left ||
                clientX > rect.right ||
                clientY < rect.top ||
                clientY > rect.bottom
            ) {
                setIsDraggingImage(false);
            }
        }
    };

    /**
     * 处理拖拽放置事件 - 支持拖拽图片到输入框
     */
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDraggingImage(false);
        
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        
        // 查找第一个图片文件
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            if (file.type.startsWith('image/')) {
                // 读取图片为 base64
                const reader = new FileReader();
                reader.onload = (event) => {
                    const dataUrl = event.target?.result as string;
                    if (!dataUrl) return;
                    
                    // 提取 base64 数据（去掉 data:image/xxx;base64, 前缀）
                    const base64Match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
                    if (base64Match) {
                        const [, mimeType, base64Data] = base64Match;
                        setPastedImage({
                            data: base64Data,
                            type: mimeType
                        });
                        console.log(`[ChatPanel] 📷 拖拽图片成功: ${file.name}, ${file.type}, ${Math.round(base64Data.length / 1024)}KB`);
                        
                        // 聚焦到输入框
                        textareaRef.current?.focus();
                    }
                };
                reader.readAsDataURL(file);
                break;  // 只处理第一张图片
            }
        }
    };

    /**
     * 处理图片生成
     * @param promptOverride 可选的提示词覆盖（从 handleSend 调用时使用）
     */
    const handleImageGeneration = async (promptOverride?: string) => {
        const prompt = promptOverride || input.trim();
        if (!prompt) {
            addLocalBlockerMessage('⚠️ 请输入图片描述', 'image-generation:missing-prompt');
            return;
        }

        const selectedModel = BFL_MODELS.find(m => m.id === selectedImageModel);
        if (!selectedModel) {
            addLocalBlockerMessage('⚠️ 请选择图片生成模型', 'image-generation:missing-model');
            return;
        }

        // 检查 BFL API Key 是否已配置
        const hasApiKey = await window.designEcho.bfl.hasApiKey();
        if (!hasApiKey) {
            addLocalBlockerMessage(
                `⚠️ **未配置 BFL API 密钥**\n\n请先在 **设置 → API 密钥 → Black Forest Labs** 中配置 API Key。\n\n获取 API Key: [bfl.ai](https://bfl.ai)`,
                'image-generation:missing-bfl-api-key'
            );
            return;
        }

        setIsGeneratingImage(true);
        if (!promptOverride) {
            setInput('');  // 只有直接调用时才清空
        }

        // addMessage 返回新消息的 ID
        const msgId = addLocalStatusMessage(
            `🎨 正在使用 ${selectedModel.name} 生成图片...\n\n**提示词**: ${prompt}`,
            'image-generation:started'
        );

        try {
            // 检查是否需要参考图片（image-to-image 类型）
            const needsImage = selectedModel.type === 'image-to-image' || selectedModel.type === 'inpainting';
            
            if (needsImage && !pastedImage) {
                updateLocalAssistantMessage(
                    msgId,
                    { content: `⚠️ ${selectedModel.name} 需要参考图片，请先粘贴或拖拽一张图片` },
                    deterministicBlockerReplyOrigin('image-generation:missing-reference-image')
                );
                setIsGeneratingImage(false);
                return;
            }

            let result: any;
            
            if (selectedModel.type === 'text-to-image' || !pastedImage) {
                // 文生图 - 参数顺序: model, prompt, options
                result = await window.designEcho.bfl.text2image(
                    selectedModel.apiModelId,
                    prompt,
                    { width: 1024, height: 1024 }
                );
            } else if (selectedModel.type === 'image-to-image') {
                // 图生图 - 参数顺序: model, prompt, inputImage, options
                result = await window.designEcho.bfl.image2image(
                    selectedModel.apiModelId,
                    prompt,
                    pastedImage.data,
                    {}
                );
            } else if (selectedModel.type === 'inpainting') {
                // 局部重绘 - 参数顺序: prompt, inputImage, maskImage, options
                result = await window.designEcho.bfl.inpaint(
                    prompt,
                    pastedImage.data,
                    pastedImage.data,  // 当前暂用原图作为蒙版，实际局部重绘应传入单独的 mask 图像
                    {}
                );
            }

            // BFLService 返回: { id, url, width, height, raw }
            if (result.success && result.data?.url) {
                // 下载图片
                const downloadResult = await window.designEcho.bfl.downloadImage(result.data.url);
                
                if (downloadResult.success && downloadResult.data) {
                    updateLocalAssistantMessage(
                        msgId,
                        {
                            content: `✅ 图片生成成功！\n\n**模型**: ${selectedModel.name}\n**提示词**: ${prompt}`,
                            image: {
                                data: downloadResult.data,
                                type: 'image/png'
                            }
                        },
                        toolSummaryReplyOrigin('image-generation:downloaded')
                    );
                    
                    // 清除参考图片
                    setPastedImage(null);
                } else {
                    updateLocalAssistantMessage(
                        msgId,
                        { content: `⚠️ 图片生成成功但下载失败\n\n**图片链接**: ${result.data.url}\n\n*链接24小时内有效*` },
                        toolSummaryReplyOrigin('image-generation:download-failed')
                    );
                }
            } else {
                updateLocalAssistantMessage(
                    msgId,
                    { content: formatUserVisibleFailureContent('图片生成失败', result.error) },
                    toolSummaryReplyOrigin('image-generation:failed')
                );
            }
        } catch (error: any) {
            console.error('[ChatPanel] 图片生成错误:', error);
            updateLocalAssistantMessage(
                msgId,
                { content: formatUserVisibleFailureContent('图片生成出错', error) },
                toolSummaryReplyOrigin('image-generation:error')
            );
        } finally {
            setIsGeneratingImage(false);
        }
    };

    const handleVisualAnalysis = async () => {
        if (!isPluginConnected) {
            addLocalBlockerMessage('⚠️ 请先连接 Photoshop 插件', 'visual-analysis:photoshop-disconnected');
            return;
        }

        if (!referenceImage) {
             addLocalAssistantMessage(
                 { content: '⚠️ 请先上传参考图' },
                 deterministicBlockerReplyOrigin('visual-analysis:missing-reference-image')
             );
             return;
        }

        setLoading(true);
        addLocalAssistantMessage(
            { content: '🔍 正在获取当前画布截图...' },
            uiStatusReplyOrigin('visual-analysis:capture-started')
        );

        try {
            // 1. 获取当前画布截图
            const snapshotResult = await window.designEcho.sendToPlugin('getDocumentSnapshot', {
                maxWidth: 800,
                maxHeight: 600,
                format: 'jpeg'
            });

            if (!snapshotResult.success) {
                throw new Error(snapshotResult.error || '获取画布截图失败');
            }

            addLocalAssistantMessage(
                { content: '🤖 正在进行视觉对比分析...' },
                uiStatusReplyOrigin('visual-analysis:model-started')
            );

            // 2. 调用 AI 视觉对比
            const aiResponse = await window.designEcho.executeTask('visual-compare', {
                image: {
                    data: referenceImage, // Base64
                    mediaType: 'image/jpeg' 
                },
                documentImage: {
                    data: snapshotResult.imageData,
                    mediaType: 'image/jpeg'
                }
            });

            // 3. 解析并展示结果。legacy 通道只展示可读摘要，结构化原文保留在内部结果中。
            let content = '分析完成。\n\n';
            
            if (aiResponse.differences) {
                content += '**视觉差异：**\n';
                aiResponse.differences.forEach((diff: any) => {
                    const dimension = sanitizeUserVisibleDiagnosticText(diff?.dimension || '项目');
                    const description = sanitizeUserVisibleAssistantBodyText(diff?.description)
                        || sanitizeUserVisibleDiagnosticText(diff?.description);
                    if (description) {
                        content += `- ${dimension}: ${description}\n`;
                    }
                });
            }

            if (aiResponse.suggestions) {
                content += '\n**改进建议：**\n';
                aiResponse.suggestions.forEach((sugg: any) => {
                    const target = sanitizeUserVisibleDiagnosticText(sugg?.target || '画面');
                    const action = sanitizeUserVisibleAssistantBodyText(sugg?.action)
                        || sanitizeUserVisibleDiagnosticText(sugg?.action);
                    const reason = sanitizeUserVisibleAssistantBodyText(sugg?.reason)
                        || sanitizeUserVisibleDiagnosticText(sugg?.reason);
                    if (action) {
                        content += `- ${target}: ${action}${reason ? `（${reason}）` : ''}\n`;
                    }
                });
            }

            if (aiResponse.summary) {
                const summary = sanitizeUserVisibleAssistantBodyText(aiResponse.summary)
                    || sanitizeUserVisibleDiagnosticText(aiResponse.summary);
                if (summary) {
                    content += `\n**总结**：${summary}`;
                }
            }

            // 如果没有结构化数据，只允许展示字符串摘要，不展示对象原始 JSON。
            if (!aiResponse.differences && !aiResponse.suggestions) {
                const textSummary = typeof aiResponse === 'string'
                    ? (sanitizeUserVisibleAssistantBodyText(aiResponse) || sanitizeUserVisibleDiagnosticText(aiResponse))
                    : '';
                content += textSummary || '这次分析没有返回可展示的摘要。';
            }

            addLocalAssistantMessage({
                content: content
            }, toolSummaryReplyOrigin('legacy-task:visual-compare'));

        } catch (error) {
             addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('分析失败', error)
            }, toolSummaryReplyOrigin('legacy-task:visual-compare:failed'));
        } finally {
            setLoading(false);
        }
    };

    const handleImageUpload = (file: File, base64: string) => {
        setReferenceImage(base64);
        addMessage({
            role: 'user',
            content: `[已上传参考图: ${file.name}]`
        });
        setShowUpload(false);
    };

    const captureScreenshotForChat = async (source: 'agent' | 'desktop') => {
        try {
            const captureResult = source === 'agent'
                ? await window.designEcho.captureAgentWindowScreenshot?.()
                : await window.designEcho.captureDesktopScreenshot?.();

            if (!captureResult?.success || !captureResult.imageBase64) {
                addLocalAssistantMessage({
                    content: formatUserVisibleFailureContent('截图失败', captureResult?.error, '接口不可用')
                }, toolSummaryReplyOrigin(`screenshot:${source}:failed`));
                return;
            }

            setPastedImage({
                data: captureResult.imageBase64,
                type: captureResult.mimeType || 'image/png'
            });
            setShowAttachMenu(false);
            textareaRef.current?.focus();
        } catch (error: any) {
            addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('截图失败', error)
            }, toolSummaryReplyOrigin(`screenshot:${source}:error`));
        }
    };
    
    /**
     * 统一的消息发送处理
     * 
     * 设计原则：
     * 1. 所有对话都交给 AI Agent 处理，保证上下文理解
     * 2. AI 可以调用工具执行操作
     * 3. 只有明确的斜杠命令才特殊处理
     */
    const handleSend = async (override?: ChatSendOverride) => {
        const hasOverride = typeof override !== 'undefined';
        const interactiveContinuationRequest = hasOverride
            ? override?.interactiveContinuationRequest
            : undefined;
        const sourceInput = hasOverride ? (override.text || '') : input;
        const overrideImage = hasOverride ? (override.image || null) : null;
        const imageToSend = hasOverride
            ? overrideImage
            : (pastedImage || (referenceImage
                ? { data: referenceImage, type: 'image/jpeg' }
                : null));

        if (!sourceInput.trim() && !imageToSend && !interactiveContinuationRequest) return;
        const stateAtSend = useAppStore.getState();
        if (chatSubmissionInFlightRef.current || stateAtSend.isLoading) {
            if (hasOverride) {
                throw new Error('当前已有设计任务正在执行，请等待完成或先停止当前任务。');
            }
            return;
        }
        const expectedConversationId = String(override?.expectedConversationId || '').trim();
        const expectedProjectId = String(override?.expectedProjectId || '').trim();
        const expectedProjectPath = String(override?.expectedProjectPath || '').trim();
        if (expectedConversationId && expectedConversationId !== String(stateAtSend.currentConversationId || '').trim()) {
            throw new Error('确认卡所属对话已经切换，本轮不会启动。请返回原对话后再次确认。');
        }
        if (expectedProjectId && expectedProjectId !== String(stateAtSend.currentProject?.id || '').trim()) {
            throw new Error('确认卡所属项目已经切换，本轮不会启动。请返回原项目后再次确认。');
        }
        if (
            expectedProjectPath
            && expectedProjectPath.toLowerCase() !== String(stateAtSend.currentProject?.path || '').trim().toLowerCase()
        ) {
            throw new Error('确认卡所属项目目录已经变化，本轮不会启动。请返回原项目后再次确认。');
        }

        chatSubmissionInFlightRef.current = true;
        try {
        const runConversationId = expectedConversationId || stateAtSend.currentConversationId;
        const userInput = sourceInput.trim();
        const providerNativeWebSearchIntent = interactiveContinuationRequest
            ? undefined
            : resolveChatWebSearchIntent({ userInput });
        setInput('');
        setPastedImage(null);  // 清除粘贴的图片
        setReferenceImage(null);
        
        if (!interactiveContinuationRequest && (userInput || imageToSend)) {
            // 如果有图片，在消息中包含图片标记
            const messageContent = imageToSend 
                ? `${userInput || '请分析这张图片'}\n\n[📷 已附带图片]`
                : userInput;
            
            addMessage({
                role: 'user',
                content: messageContent,
                image: imageToSend ? { data: imageToSend.data, type: imageToSend.type } : undefined
            });
        }

        // 只有斜杠命令特殊处理
        if (!interactiveContinuationRequest && userInput.startsWith('/')) {
            handleCommand(userInput);
            return;
        }

        // ======== 图片生成模式：直接调用 FLUX API ========
        if (!interactiveContinuationRequest && showImageGen && userInput) {
            await handleImageGeneration(userInput);
            return;
        }

        // ======== 快捷命令模式：对于常见操作直接执行，不调用 AI ========
        if (!interactiveContinuationRequest) {
            const quickResult = await tryQuickCommand(userInput);
            if (quickResult.handled) {
                // 快捷命令已处理
                addLocalAssistantMessage(
                    { content: quickResult.message || '' },
                    toolSummaryReplyOrigin('quick-command:result')
                );
                return;
            }
        }

        // 所有其他对话都交给 AI Agent 处理
        const runId = `agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setLoading(true);
        try {
            await handleUnifiedAgent(userInput, imageToSend || undefined, {
                runId,
                conversationId: runConversationId,
                publicPlanConfirmationSourceMessageId: hasOverride
                    ? override?.publicPlanConfirmationSourceMessageId
                    : undefined,
                publicPlanDisposableLiveAdapter: hasOverride
                    ? override?.publicPlanDisposableLiveAdapter
                    : undefined,
                interactiveContinuationRequest,
                providerNativeWebSearchIntent
            });
        } catch (error) {
            console.error('Agent error:', error);
            if (activeAgentRunIdRef.current === runId) {
                addLocalAssistantMessage({
                    content: formatUserVisibleFailureContent('处理失败', error)
                }, uiStatusReplyOrigin('agent-run:outer-error'), { conversationId: runConversationId });
            }
        } finally {
            if (activeAgentRunIdRef.current === runId) {
                setLoading(false);
                activeAgentRunIdRef.current = null;
                if (activeAgentRunUiRef.current?.runId === runId) {
                    activeAgentRunUiRef.current = null;
                }
                cancelledAgentRunIdsRef.current.delete(runId);
                setAbortController(null);
            } else {
                cancelledAgentRunIdsRef.current.delete(runId);
            }
        }
        } finally {
            chatSubmissionInFlightRef.current = false;
        }
    };

    handleSendRef.current = handleSend;

    const buildChatTestSnapshot = useCallback(() => {
        const state = useAppStore.getState();
        return {
            isLoading: state.isLoading,
            messageCount: state.messages.length,
            messages: state.messages.map((message) => {
                const converted = convertLegacyMessage(message as any);
                const thinkingBlockTitles = converted.blocks
                    .filter((block: any) => block.type === 'thinking')
                    .map((block: any) => String(block.title || '').trim())
                    .filter(Boolean);
                const cardBlocks = converted.blocks.filter((block: any) => block.type === 'card');
                const cardTitles = cardBlocks
                    .map((block: any) => String(block.title || '').trim())
                    .filter(Boolean);
                const cardVariants = cardBlocks
                    .map((block: any) => String(block.variant || '').trim())
                    .filter(Boolean);
                const businessPreflightCardTitles = cardTitles
                    .filter((title) => title.includes('处理前先确认'));
                const agentDiagnosticRecord = (message as any).agentDiagnosticRecord;
                const modelMediatedUserReplyUnavailable =
                    agentDiagnosticRecord?.modelMediatedUserReplyUnavailable
                    && typeof agentDiagnosticRecord.modelMediatedUserReplyUnavailable === 'object'
                        ? agentDiagnosticRecord.modelMediatedUserReplyUnavailable as Record<string, unknown>
                        : undefined;
                const businessVisualObservationFeedback = (message as any).businessVisualObservationFeedback;
                const conversationalModelFailure = (message as any).conversationalModelFailure;
                const publicPlanExecutionRequest = (message as any).agentTaskPublicPlanExecutionRequest;
                const publicPlanControlledRun = (message as any).agentTaskPublicPlanControlledRun;
                const conversationalFailureAttempts = Array.isArray(conversationalModelFailure?.attempts)
                    ? conversationalModelFailure.attempts
                        .map((attempt: any) => ({
                            purpose: sanitizeTestSnapshotToken(attempt?.purpose),
                            status: sanitizeTestSnapshotToken(attempt?.status),
                            errorKind: sanitizeTestSnapshotToken(attempt?.errorKind),
                            reason: sanitizeTestSnapshotToken(attempt?.reason)
                        }))
                        .filter((attempt: any) => attempt.purpose || attempt.status || attempt.errorKind)
                        .slice(0, 4)
                    : [];
                const visibleTextPreview = collectChatSnapshotVisibleStrings(converted.blocks)
                    .join('\n')
                    .slice(0, 2500);
                return {
                    id: message.id,
                    role: message.role,
                    assistantReplyOrigin: message.assistantReplyOrigin,
                    contentPreview: typeof message.content === 'string'
                        ? sanitizeTestSnapshotPreview(message.content).slice(0, 1000)
                        : '',
                    visibleTextPreview,
                    hasImage: !!message.image,
                    thinkingStepCount: Array.isArray(message.thinkingSteps) ? message.thinkingSteps.length : 0,
                    thinkingPreview: Array.isArray(message.thinkingSteps)
                        ? message.thinkingSteps
                            .map(step => formatTestSnapshotThinkingStep(step))
                            .join('\n')
                            .slice(0, 1500)
                        : '',
                    thinkingBlockTitles,
                    cardTitles,
                    cardVariants,
                    agentUserVisibleState: resolveChatSnapshotAgentUserVisibleState(message),
                    agentDiagnosticRecordKeys: Array.isArray(agentDiagnosticRecord?.recordKeys)
                        ? agentDiagnosticRecord.recordKeys
                            .map((key: unknown) => sanitizeTestSnapshotToken(key))
                            .filter(Boolean)
                        : [],
                    modelMediatedUserReplyUnavailable: modelMediatedUserReplyUnavailable
                        ? {
                            reason: sanitizeTestSnapshotToken(modelMediatedUserReplyUnavailable.reason),
                            rawResponseShape: sanitizeTestSnapshotPreview(modelMediatedUserReplyUnavailable.rawResponseShape),
                            rawTextPreview: sanitizeTestSnapshotPreview(modelMediatedUserReplyUnavailable.rawTextPreview),
                            sanitizedTextPreview: sanitizeTestSnapshotPreview(modelMediatedUserReplyUnavailable.sanitizedTextPreview),
                            errorPreview: sanitizeTestSnapshotPreview(modelMediatedUserReplyUnavailable.errorPreview)
                        }
                        : undefined,
                    businessPreflightCardTitles,
                    businessPreflightCardCount: businessPreflightCardTitles.length,
                    hasBusinessVisualObservationFeedback: !!businessVisualObservationFeedback,
                    businessVisualObservationFeedbackUserVisible: businessVisualObservationFeedback?.userVisible === true,
                    businessVisualObservationFeedbackSeverity: sanitizeTestSnapshotPreview(businessVisualObservationFeedback?.severity),
                    hasPublicPlanExecutionRequest: !!publicPlanExecutionRequest,
                    publicPlanRawStatus: sanitizeTestSnapshotToken(publicPlanExecutionRequest?.status),
                    publicPlanRequestStatus: sanitizeTestSnapshotPreview(publicPlanExecutionRequest?.status),
                    publicPlanProposedWriteTools: Array.isArray(publicPlanExecutionRequest?.proposedWriteTools)
                        ? publicPlanExecutionRequest.proposedWriteTools.map((toolName: unknown) => sanitizeTestSnapshotToken(toolName)).filter(Boolean)
                        : [],
                    publicPlanAllowedWriteTools: Array.isArray(publicPlanExecutionRequest?.allowedWriteTools)
                        ? publicPlanExecutionRequest.allowedWriteTools.map((toolName: unknown) => sanitizeTestSnapshotToken(toolName)).filter(Boolean)
                        : [],
                    publicPlanReadbackTargets: Array.isArray(publicPlanExecutionRequest?.readbackTargets)
                        ? publicPlanExecutionRequest.readbackTargets.map((target: unknown) => sanitizeTestSnapshotToken(target)).filter(Boolean)
                        : [],
                    publicPlanOperationCount: Array.isArray(publicPlanExecutionRequest?.operationRequests)
                        ? publicPlanExecutionRequest.operationRequests.length
                        : 0,
                    publicPlanApprovalStatus: sanitizeTestSnapshotPreview((message as any).agentTaskPublicPlanApprovalRecord?.status),
                    hasPublicPlanControlledRun: !!publicPlanControlledRun,
                    publicPlanControlledRunStatus: sanitizeTestSnapshotPreview(publicPlanControlledRun?.status),
                    publicPlanControlledRunBlockers: Array.isArray(publicPlanControlledRun?.blockers)
                        ? publicPlanControlledRun.blockers.map((blocker: unknown) => sanitizeTestSnapshotPreview(blocker)).filter(Boolean)
                        : [],
                    publicPlanControlledRunOperationResults: summarizePublicPlanControlledRunOperationResults(publicPlanControlledRun),
                    toolResultCount: Array.isArray(message.thinkingSteps)
                        ? message.thinkingSteps.filter(step => !!(step as any).toolResult).length
                        : 0,
                    executionStatus: sanitizeTestSnapshotToken((message.executionSummary as any)?.status),
                    executionSummaryPreview: typeof (message.executionSummary as any)?.summaryText === 'string'
                        ? sanitizeTestSnapshotPreview((message.executionSummary as any).summaryText).slice(0, 1000)
                        : '',
                    conversationalFailureKind: sanitizeTestSnapshotToken(conversationalModelFailure?.kind),
                    conversationalFailureAttempts
                };
            })
        };
    }, []);

    const waitForChatIdle = useCallback(async (timeoutMs = 30000) => {
        const started = Date.now();
        while (useAppStore.getState().isLoading) {
            if (Date.now() - started > timeoutMs) {
                throw new Error(`ChatPanel test bridge timed out after ${timeoutMs}ms`);
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return buildChatTestSnapshot();
    }, [buildChatTestSnapshot]);

    const waitForChatRunStartOrAssistant = useCallback(async (beforeMessageCount: number, timeoutMs = 5000) => {
        const started = Date.now();
        while (Date.now() - started <= timeoutMs) {
            const state = useAppStore.getState();
            const newMessages = state.messages.slice(beforeMessageCount);
            if (state.isLoading || newMessages.some(message => message.role === 'assistant')) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }, []);

    const resetChatTestConversation = useCallback(() => {
        const state = useAppStore.getState();
        if (state.isLoading) {
            throw new Error('Cannot reset the ChatPanel test conversation while a request is running.');
        }
        state.createConversation();
        return buildChatTestSnapshot();
    }, [buildChatTestSnapshot]);

    useEffect(() => {
        // 编译期常量是测试桥的唯一生产边界；生产构建会连同动态模块一起移除。
        if (process.env.NODE_ENV !== 'development') return;
        const enabled = new URLSearchParams(window.location.search || '')
            .get('designechoChatTestBridge') === '1';
        if (!enabled) return;

        let disposed = false;
        let uninstall: (() => void) | undefined;
        void import('../testing/chat-panel-test-bridge').then((testBridge) => {
            if (disposed) return;
            uninstall = testBridge.installChatPanelTestBridge({
                version: 1,
                submit: async (text: string, options?: { image?: { data: string; type: string }; timeoutMs?: number; publicPlanConfirmationSourceMessageId?: string; publicPlanDisposableLiveAdapter?: boolean }) => {
                    if (chatSubmissionInFlightRef.current || useAppStore.getState().isLoading) {
                        throw new Error('当前已有设计任务正在执行，请等待完成或先停止当前任务。');
                    }
                    const before = buildChatTestSnapshot();
                    const sendPromise = handleSend({
                        text,
                        image: options?.image || null,
                        publicPlanConfirmationSourceMessageId: options?.publicPlanConfirmationSourceMessageId,
                        publicPlanDisposableLiveAdapter: options?.publicPlanDisposableLiveAdapter
                    });
                    void sendPromise.catch(error => {
                        console.warn('[ChatPanelTestBridge] submit send failed:', error);
                    });
                    await waitForChatRunStartOrAssistant(before.messageCount, Math.min(options?.timeoutMs || 30000, 5000));
                    return waitForChatIdle(options?.timeoutMs);
                },
                getSnapshot: buildChatTestSnapshot,
                resetConversation: resetChatTestConversation,
                waitForIdle: waitForChatIdle,
                getLatestAcceptanceDebug: (acceptanceCase, options) => {
                    const state = useAppStore.getState();
                    const assistantMessages = state.messages.filter((message) => message.role === 'assistant');
                    const targetMessage = options?.messageId
                        ? assistantMessages.find((message) => message.id === options.messageId)
                        : assistantMessages[assistantMessages.length - 1];
                    if (!targetMessage) {
                        throw new Error('No assistant message is available for acceptance debug export.');
                    }
                    return testBridge.buildChatPanelAcceptanceDebug({
                        acceptanceCase,
                        message: {
                            content: targetMessage.content,
                            agentRequestLifecycle: targetMessage.agentRequestLifecycle,
                            executionSummary: targetMessage.executionSummary,
                            agentDiagnosticRecord: targetMessage.agentDiagnosticRecord,
                            thinkingSteps: targetMessage.thinkingSteps
                        }
                    });
                }
            });
        });

        return () => {
            disposed = true;
            uninstall?.();
        };
    }, [buildChatTestSnapshot, handleSend, resetChatTestConversation, waitForChatIdle, waitForChatRunStartOrAssistant]);

    useEffect(() => {
        const unsubscribe = window.designEcho?.onDebugBridgeChatSubmit?.(async (request) => {
            const text = String(request?.text || '').trim();
            if (!text) {
                throw new Error('Debug Bridge chat submit requires text.');
            }
            if (chatSubmissionInFlightRef.current || useAppStore.getState().isLoading) {
                throw new Error('当前已有设计任务正在执行，请等待完成或先停止当前任务。');
            }
            const timeoutMs = Math.max(1000, Math.min(Number(request.timeoutMs) || 60000, 300000));
            if (request.resetConversation) {
                resetChatTestConversation();
            }
            const before = buildChatTestSnapshot();
            const sendPromise = handleSend({
                text,
                image: null,
                publicPlanConfirmationSourceMessageId: request.publicPlanConfirmationSourceMessageId,
                publicPlanDisposableLiveAdapter: request.publicPlanDisposableLiveAdapter
            });
            void sendPromise.catch(error => {
                console.warn('[DebugBridgeChatSubmit] submit send failed:', error);
            });
            await waitForChatRunStartOrAssistant(before.messageCount, Math.min(timeoutMs, 5000));
            return waitForChatIdle(timeoutMs);
        });
        return () => {
            unsubscribe?.();
        };
    }, [buildChatTestSnapshot, handleSend, resetChatTestConversation, waitForChatIdle, waitForChatRunStartOrAssistant]);

    /**
     * 快捷命令处理器
     * 对于常见的简单操作，直接执行而不调用 AI 模型
     * 大幅提升响应速度！
     */
    /**
     * 快捷命令处理
     * 
     * 设计原则：
     * - 只处理【单词级】的简单命令（撤销、保存、重做）
     * - 其他所有请求都交给 AI 处理，让 AI 理解用户意图
     * - 避免机械式的关键词匹配
     */
    const tryQuickCommand = async (input: string): Promise<{ handled: boolean; message?: string }> => {
        const trimmed = input.trim().toLowerCase();
        
        // ===== 只处理单词级的简单命令 =====
        
        // 撤销
        if (trimmed === '撤销' || trimmed === 'undo') {
            try {
                const result = await executeToolCall('undo', {});
                return { handled: true, message: result?.success ? '✅ 已撤销' : `❌ ${result?.error || '撤销失败'}` };
            } catch (e: any) {
                return { handled: true, message: `❌ ${e.message}` };
            }
        }
        
        // 重做
        if (trimmed === '重做' || trimmed === 'redo') {
            try {
                const result = await executeToolCall('redo', {});
                return { handled: true, message: result?.success ? '✅ 已重做' : `❌ ${result?.error || '重做失败'}` };
            } catch (e: any) {
                return { handled: true, message: `❌ ${e.message}` };
            }
        }
        
        // 保存（仅单词）
        if (trimmed === '保存' || trimmed === 'save') {
            try {
                const result = await executeToolCall('smartSave', {});
                return { handled: true, message: result?.message || (result?.success ? '✅ 已保存' : `❌ ${result?.error || '保存失败'}`) };
            } catch (e: any) {
                return { handled: true, message: `❌ ${e.message}` };
            }
        }
        
        // 其他所有请求都交给 AI 处理
        // AI 会理解用户意图，而不是机械式匹配关键词
        return { handled: false };
    };

    /**
     * 统一的 AI Agent 处理器
     * 
     * 新架构：
     * 1. AI 理解用户意图（不是关键词匹配）
     * 2. AI 选择工具/技能（根据理解做决策）
     * 3. 执行决策并返回结果
     * 4. 支持多轮对话
     */
    const handleUnifiedAgent = async (
        userInput: string,
        attachedImage?: { data: string; type: string },
        runOptions?: {
            runId?: string;
            conversationId?: string | null;
            publicPlanConfirmationSourceMessageId?: string;
            publicPlanDisposableLiveAdapter?: boolean;
            interactiveContinuationRequest?: InteractiveContinuationRequest;
            providerNativeWebSearchIntent?: ChatWebSearchIntent;
        }
    ) => {
        // ========== Agent 执行流程：只展示真实模型反馈和真实工具事件 ==========
        
        // 创建 AbortController 用于取消任务
        const runId = runOptions?.runId || `agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const runConversationId = runOptions?.conversationId || useAppStore.getState().currentConversationId;
        const submissionState = useAppStore.getState() as any;
        const submissionProject = submissionState?.currentProject;
        const submissionProjectId = String(submissionProject?.id || '').trim();
        const submissionProjectPath = String(submissionProject?.path || '').trim();
        const submissionProjectName = String(submissionProject?.name || '').trim();
        const submissionWorkspaceObservedAt = new Date().toISOString();
        const submissionActiveWorkspacePage = String(activeWorkspacePage || '').trim() || undefined;
        const submissionWorkflowContext = toOperatingWorkflowContext(workflowSelectionContext);
        const submissionSelectedAssetContext = selectedAssetContext
            ? { ...selectedAssetContext }
            : undefined;
        const submissionSelectedEagleLibraryAsset = selectedEagleLibraryAsset
            ? {
                ...selectedEagleLibraryAsset,
                tags: [...selectedEagleLibraryAsset.tags],
                folderPaths: [...selectedEagleLibraryAsset.folderPaths]
            }
            : undefined;
        const submissionSelectedEagleAssetGroup = selectedEagleAssetGroup && selectedEagleAssetGroup.length > 0
            ? selectedEagleAssetGroup.map((ref) => ({ ...ref, tags: [...ref.tags], folderPaths: [...ref.folderPaths] }))
            : undefined;
        const submissionKnowledgeReferences = knowledgeReferences.map((reference) => ({ ...reference }));
        const controller = new AbortController();
        setAbortController(controller);
        const signal = controller.signal;
        activeAgentRunIdRef.current = runId;
        cancelledAgentRunIdsRef.current.delete(runId);
        activeAgentRunUiRef.current = {
            runId,
            conversationId: runConversationId,
            streamedAssistantMessageId: null,
            visibleSteps: [],
            stopMessageShown: false
        };

        const addRunAssistantMessage = (
            message: AssistantMessageWithOriginInput,
            origin: AssistantReplyOrigin
        ) => addLocalAssistantMessage(message, origin, { conversationId: runConversationId });

        const updateRunAssistantMessage = (
            messageId: string,
            updates: AssistantMessageUpdateWithOriginInput,
            origin: AssistantReplyOrigin
        ) => updateLocalAssistantMessage(messageId, updates, origin, { conversationId: runConversationId });

        const isActiveAgentRun = () => activeAgentRunIdRef.current === runId;
        const isRunCancelled = () => Boolean(signal.aborted || cancelledAgentRunIdsRef.current.has(runId));
        const canApplyRunUpdate = () => isActiveAgentRun() && !isRunCancelled();
        const throwIfRunStopped = () => {
            if (!isActiveAgentRun() || isRunCancelled()) {
                throw new Error('任务已取消');
            }
        };
        
        const thinkingStartTime = Date.now();
        const attachedImages = attachedImage
            ? createDesignImageInputs([{
                data: attachedImage.data,
                mediaType: attachedImage.type,
                source: 'chat-paste'
            }])
            : [];
        const hasAttachedImage = attachedImages.length > 0;
        
        // 收集可见执行结果。普通系统日志不能伪装成模型思考。
        const collectedSteps: ThinkingStep[] = [];
        const stepStartTimes: Record<string, number> = {};
        let hasStructuredToolEvents = false;
        let thinkingStepId: string | null = null;
        const toolStepIdsByCallId = new Map<string, string>();

        const syncActiveRunVisibleSteps = (): void => {
            if (activeAgentRunUiRef.current?.runId !== runId) return;
            activeAgentRunUiRef.current.visibleSteps = [...collectedSteps];
        };
        
        // 添加可见步骤的辅助函数。
        const addStep = (step: Omit<ThinkingStep, 'id' | 'timestamp'>): string => {
            const id = `step-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            if (!canApplyRunUpdate()) {
                return id;
            }
            const newStep: ThinkingStep = {
                ...step,
                id,
                timestamp: Date.now()
            };
            collectedSteps.push(newStep);
            stepStartTimes[id] = Date.now();
            syncActiveRunVisibleSteps();
            
            // 同步到 UI 状态
            setThinkingSteps([...collectedSteps]);
            if (isVisiblePonderingStep(newStep)) {
                setLiveActivity(null);
            }
            return id;
        };
        
        // 清理 AI 响应中可能残留的结构化 JSON 或工具调用标记。
        const cleanResponseContent = sanitizeUserVisibleAssistantBodyText;

        const hasVisibleAssistantPayload = (input: {
            content?: string;
            image?: any;
            thinkingSteps?: ThinkingStep[];
            executionSummary?: AgentExecutionSummary;
            agentTaskPlanPresentation?: AgentTaskPlanPresentation;
            businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
            agentTaskPublicPlanExecutionRequest?: any;
            agentTaskPublicPlanControlledRun?: any;
            skuDeliverySummary?: SkuDeliverySummary;
            interactiveCards?: InteractiveCardDefinition[];
        }): boolean => {
            if (cleanResponseContent(input.content || '').trim()) return true;
            if (input.image) return true;
            if (Array.isArray(input.thinkingSteps) && input.thinkingSteps.length > 0) return true;
            if (input.executionSummary?.summaryText) return true;
            if (input.agentTaskPlanPresentation) return true;
            if (input.businessVisualObservationFeedback?.userVisible === true) return true;
            if (input.agentTaskPublicPlanExecutionRequest) return true;
            if (input.agentTaskPublicPlanControlledRun) return true;
            if (input.skuDeliverySummary) return true;
            if (Array.isArray(input.interactiveCards) && input.interactiveCards.length > 0) return true;
            return false;
        };

        const buildMissingVisibleResultContent = (taskPlan: any): string => {
            const visibleState = taskPlan?.userVisibleState || taskPlan?.data?.userVisibleState;
            const summary = sanitizeUserVisibleAssistantBodyText(visibleState?.summary || '').trim();
            const nextStep = sanitizeUserVisibleAssistantBodyText(visibleState?.nextStep || '').trim();
            const stateText = [summary, nextStep ? `下一步：${nextStep}` : '']
                .filter(Boolean)
                .join('\n');
            return stateText
                || '这次没有拿到可展示的观察结果，我不能把它当成已完成。需要重新读取项目图片后再继续判断。';
        };
        
        // 非流式结果直接显示；普通对话的真实 token 流由 streamChatAsync 更新消息。
        const displayAssistantMessage = async (
            fullContent: string, 
            options?: {
                image?: any;
                thinkingSteps?: ThinkingStep[];
                executionSummary?: AgentExecutionSummary;
                agentTaskPlanPresentation?: AgentTaskPlanPresentation;
                assistantReplyOrigin?: AssistantReplyOrigin;
                agentRequestLifecycle?: AgentRequestLifecycleRecord;
                agentDiagnosticRecord?: AgentDiagnosticRecord;
                businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
                agentTaskPlan?: any;
                agentTaskPublicPlan?: any;
                agentTaskPublicPlanExecutionRequest?: any;
                agentTaskPublicPlanApprovalRecord?: any;
                agentTaskPublicPlanControlledRun?: any;
                skuDeliverySummary?: SkuDeliverySummary;
                interactiveCards?: InteractiveCardDefinition[];
                pendingInteractiveContinuation?: PendingInteractiveContinuation;
                conversationalModelFailure?: any;
            }
        ) => {
            if (!canApplyRunUpdate()) return;
            const cleanedContent = cleanResponseContent(fullContent);
            if (!hasVisibleAssistantPayload({
                content: cleanedContent,
                image: options?.image,
                thinkingSteps: options?.thinkingSteps,
                executionSummary: options?.executionSummary,
                agentTaskPlanPresentation: options?.agentTaskPlanPresentation,
                businessVisualObservationFeedback: options?.businessVisualObservationFeedback,
                agentTaskPublicPlanExecutionRequest: options?.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanControlledRun: options?.agentTaskPublicPlanControlledRun,
                skuDeliverySummary: options?.skuDeliverySummary,
                interactiveCards: options?.interactiveCards
            })) {
                return;
            }
            const publicPlanPayload = buildPublicPlanMessagePayload({
                agentTaskPublicPlanExecutionRequest: options?.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanControlledRun: options?.agentTaskPublicPlanControlledRun
            });

            const messageId = addRunAssistantMessage({
                content: cleanedContent,
                image: options?.image,
                thinkingSteps: options?.thinkingSteps,
                executionSummary: options?.executionSummary,
                agentTaskPlanPresentation: options?.agentTaskPlanPresentation,
                agentRequestLifecycle: options?.agentRequestLifecycle,
                agentDiagnosticRecord: options?.agentDiagnosticRecord,
                businessVisualObservationFeedback: options?.businessVisualObservationFeedback,
                agentTaskPlan: options?.agentTaskPlan,
                agentTaskPublicPlan: options?.agentTaskPublicPlan,
                agentTaskPublicPlanExecutionRequest: publicPlanPayload.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanApprovalRecord: options?.agentTaskPublicPlanApprovalRecord,
                agentTaskPublicPlanControlledRun: publicPlanPayload.agentTaskPublicPlanControlledRun,
                skuDeliverySummary: options?.skuDeliverySummary,
                interactiveCards: options?.interactiveCards,
                pendingInteractiveContinuation: options?.pendingInteractiveContinuation,
                conversationalModelFailure: options?.conversationalModelFailure,
                isThinking: false
            }, options?.assistantReplyOrigin || uiStatusReplyOrigin('agent-display:missing-result-origin'));
            cachePrivatePublicPlanOperationRequests(messageId, options?.agentTaskPublicPlanExecutionRequest);
        };

        const formatFailureContent = (
            message: string | undefined,
            error: string | undefined,
            summary: AgentExecutionSummary | undefined,
            feedback?: BusinessSkillVisualObservationFeedback
        ): string => {
            return formatAssistantFailureContent({
                message,
                error,
                summaryText: summary?.summaryText,
                successfulMutationCalls: summary?.successfulMutationCalls,
                businessVisualObservationFeedback: feedback
            });
        };

        const buildFallbackFailureContent = (
            feedback: BusinessSkillVisualObservationFeedback | undefined,
            taskPlan: any,
            executionResultSummary?: AgentExecutionSummary
        ): string => {
            const feedbackContent = formatAssistantBusinessVisualFeedbackContent({
                message: '',
                businessVisualObservationFeedback: feedback
            });
            if (feedbackContent.trim()) return feedbackContent.trim();

            const visibleState = taskPlan?.userVisibleState || taskPlan?.data?.userVisibleState;
            const summary = sanitizeUserVisibleAssistantBodyText(visibleState?.summary || '').trim();
            const nextStep = sanitizeUserVisibleAssistantBodyText(visibleState?.nextStep || '').trim();
            const stateText = [summary, nextStep]
                .filter(Boolean)
                .filter((item, index, list) => list.indexOf(item) === index)
                .join('\n');
            if (stateText) {
                const resultState = Number(executionResultSummary?.successfulMutationCalls || 0) > 0
                    ? '当前处理没有完成，但本轮已经产生画面或文件改动，请先复核现有结果。'
                    : '当前处理没有完成，本轮没有改动画面。';
                return [resultState, stateText].join('\n');
            }

            return Number(executionResultSummary?.successfulMutationCalls || 0) > 0
                ? '当前处理没有完成，但本轮已经产生画面或文件改动。请先复核现有结果，再决定继续调整或恢复。'
                : '当前处理没有完成，本轮没有改动画面。请先补齐素材理解或执行条件后再重试。';
        };
        
        // 更新思维步骤
        const updateStep = (stepId: string, updates: Partial<ThinkingStep>) => {
            if (!canApplyRunUpdate()) return;
            const idx = collectedSteps.findIndex(s => s.id === stepId);
            console.log('[ChatPanel] updateStep 调用:', { stepId, idx, updates: updates.content?.substring(0, 30), stepCount: collectedSteps.length });
            if (idx !== -1) {
                // 如果状态变为完成，计算耗时
                if (updates.status === 'success' || updates.status === 'error') {
                    const startTime = stepStartTimes[stepId];
                    if (startTime) {
                        updates.duration = Date.now() - startTime;
                    }
                }
                collectedSteps[idx] = { ...collectedSteps[idx], ...updates };
                const newSteps = [...collectedSteps];
                syncActiveRunVisibleSteps();
                console.log('[ChatPanel] 更新后的步骤:', newSteps.map(s => ({ type: s.type, content: s.content?.substring(0, 20), status: s.status })));
                setThinkingSteps(newSteps);
                if (isVisiblePonderingStep(collectedSteps[idx])) {
                    setLiveActivity(null);
                }
            }
        };

        const visibleWebSearchIntent = runOptions?.providerNativeWebSearchIntent;
        let providerNativeWebSearchStepId: string | null = null;

        const canAttachProviderNativeWebSearchToModelCall = (options?: any): boolean => {
            if (!visibleWebSearchIntent) return false;
            if (options?.silent === true) return false;
            const purpose = String(options?.purpose || '').trim();
            if (!purpose) return true;
            return purpose === 'direct_response' || purpose === 'direct_response_repair';
        };

        const markProviderNativeWebSearchStarted = () => {
            if (!visibleWebSearchIntent || providerNativeWebSearchStepId) return;
            providerNativeWebSearchStepId = addStep({
                type: 'tool_call',
                content: formatChatWebSearchVisibleStep(visibleWebSearchIntent),
                toolName: 'providerNativeWebSearch',
                status: 'running'
            });
        };

        const markProviderNativeWebSearchCompleted = (response?: any) => {
            if (!visibleWebSearchIntent || !providerNativeWebSearchStepId) return;
            const citationCount = Array.isArray(response?.citations) ? response.citations.length : 0;
            updateStep(providerNativeWebSearchStepId, {
                content: formatChatWebSearchCompletedStep(visibleWebSearchIntent, { citationCount }),
                status: 'success',
                toolResult: citationCount > 0
                    ? { success: true, citationCount }
                    : { success: true }
            });
        };

        const markProviderNativeWebSearchFailed = () => {
            if (!visibleWebSearchIntent || !providerNativeWebSearchStepId) return;
            updateStep(providerNativeWebSearchStepId, {
                content: `${formatChatWebSearchVisibleStep(visibleWebSearchIntent)}（未完成）`,
                status: 'error',
                toolResult: { success: false }
            });
        };

        const mergeVisibleThinking = (current: string, next: string): string => {
            const currentText = String(current || '').trim();
            const nextText = String(next || '').trim();
            if (!currentText) return nextText;
            if (!nextText) return currentText;
            if (nextText.startsWith(currentText)) return nextText;
            if (currentText.includes(nextText)) return currentText;
            return `${currentText}\n\n${nextText}`;
        };

        const handleAgentStep = (event: AgentStepEvent) => {
            if (!canApplyRunUpdate()) return;
            const activity = buildVisibleAgentActivityFromStepEvent(event);
            if (activity) {
                setLiveActivity(activity);
            }
            if (event?.title && isVisibleAgentProcessEvent(event)) {
                const content = formatAgentProcessEventContent(event);
                if (content) {
                    addStep({
                        type: getVisibleAgentProcessStepType(event),
                        content,
                        status: event.status
                    });
                }
                return;
            }
            if (!event?.title || !isVisibleAgentStepEvent(event)) return;
            const content = formatAgentToolEventContent(event);

            if (event.kind === 'tool_started') {
                hasStructuredToolEvents = true;
                // 工具开始 = 当前思考片段结束：把进行中的思考 step 收尾，并清空 thinking step 引用，
                // 让下一轮推理新建独立 step，从而思考与工具按时间交替（think→tool→think→tool），
                // 而不是把多轮推理累积进同一个 step（之前所有思考堆成一大段、和工具割裂的根因）。
                if (thinkingStepId) {
                    const prevThinking = collectedSteps.find(s => s.id === thinkingStepId);
                    if (prevThinking && prevThinking.status === 'running') {
                        updateStep(thinkingStepId, { status: 'success' });
                    }
                    thinkingStepId = null;
                }
                streamedThinkingStepId = null;
                const id = addStep({
                    type: 'tool_call',
                    content,
                    toolName: event.toolName,
                    status: 'running'
                });
                if (event.toolCallId) {
                    toolStepIdsByCallId.set(event.toolCallId, id);
                }
                return;
            }

            if (event.kind === 'tool_completed') {
                hasStructuredToolEvents = true;
                const stepId = event.toolCallId ? toolStepIdsByCallId.get(event.toolCallId) : undefined;
                const fallback = collectedSteps
                    .slice()
                    .reverse()
                    .find(step => step.type === 'tool_call' && step.toolName === event.toolName && step.status === 'running');
                const targetId = stepId || fallback?.id;
                if (targetId) {
                    updateStep(targetId, {
                        content,
                        status: event.status === 'success' ? 'success' : 'error'
                    });
                } else {
                    addStep({
                        type: 'tool_result',
                        content,
                        toolName: event.toolName,
                        status: event.status === 'success' ? 'success' : 'error'
                    });
                }
                return;
            }
        };
        
        // 活动 run 在首个 provider / 工具事件到达前也必须有可见状态。
        // 这里只表达正在发生的 Harness 上下文读取，不冒充模型思考或执行结论。
        clearThinkingSteps(false);
        setShowThinking(true);
        setLiveActivity(buildVisibleAgentActivityFromRunPhase('context_loading'));

        let hasVisibleStreamedAssistantContent = false;
        let streamedAssistantMessageId: string | null = null;
        let streamedThinkingStepId: string | null = null;

        const settleLiveThinkingBeforeAnswerStream = (): void => {
            if (hasVisibleStreamedAssistantContent) return;
            hasVisibleStreamedAssistantContent = true;
            collectedSteps
                .filter(step => step.type === 'thinking' && step.status === 'running')
                .forEach(step => updateStep(step.id, { status: 'success' }));
            setShowThinking(false);
            setLiveActivity(null);
        };

        const updateStreamedAssistantContent = (
            content: string,
            streamSource: {
                source: 'provider-visible-token-stream';
                modelId: string;
                isThinking?: boolean;
            }
        ) => {
            if (!canApplyRunUpdate()) return;
            if (streamSource.source !== 'provider-visible-token-stream' || !streamSource.modelId) return;
            const visibleContent = sanitizeUserVisibleAssistantBodyText(content);
            if (!visibleContent.trim()) return;

            settleLiveThinkingBeforeAnswerStream();
            const visibleContentOrigin = modelAuthoredReplyOrigin('agent-stream:visible-content');
            if (!streamedAssistantMessageId) {
                streamedAssistantMessageId = addRunAssistantMessage({
                    content: visibleContent,
                    isThinking: streamSource.isThinking ?? true
                }, visibleContentOrigin);
                if (activeAgentRunUiRef.current?.runId === runId) {
                    activeAgentRunUiRef.current.streamedAssistantMessageId = streamedAssistantMessageId;
                }
                setLiveActivity(null);
                return;
            }

            setLiveActivity(null);
            updateRunAssistantMessage(
                streamedAssistantMessageId,
                {
                    content: visibleContent,
                    isThinking: streamSource.isThinking ?? true
                },
                visibleContentOrigin
            );
        };

        const updateStreamedVisibleReasoning = (content: string, status: ThinkingStep['status'] = 'running') => {
            if (!canApplyRunUpdate()) return;
            if (hasVisibleStreamedAssistantContent) return;
            const visibleText = sanitizeUserVisibleThinkingText(content);
            if (!visibleText) return;
            setLiveActivity(null);
            if (!streamedThinkingStepId) {
                streamedThinkingStepId = addStep({
                    type: 'thinking',
                    content: visibleText,
                    status
                });
                return;
            }
            updateStep(streamedThinkingStepId, {
                content: visibleText,
                status
            });
        };

        const finalizeStreamedAssistantMessage = (
            content: string,
            options?: {
                image?: any;
                thinkingSteps?: ThinkingStep[];
                executionSummary?: AgentExecutionSummary;
                agentTaskPlanPresentation?: AgentTaskPlanPresentation;
                assistantReplyOrigin?: AssistantReplyOrigin;
                agentRequestLifecycle?: AgentRequestLifecycleRecord;
                agentDiagnosticRecord?: AgentDiagnosticRecord;
                businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
                agentTaskPlan?: any;
                agentTaskPublicPlan?: any;
                agentTaskPublicPlanExecutionRequest?: any;
                agentTaskPublicPlanApprovalRecord?: any;
                agentTaskPublicPlanControlledRun?: any;
                skuDeliverySummary?: SkuDeliverySummary;
                interactiveCards?: InteractiveCardDefinition[];
                pendingInteractiveContinuation?: PendingInteractiveContinuation;
                conversationalModelFailure?: any;
            }
        ) => {
            if (!canApplyRunUpdate() || !streamedAssistantMessageId) return false;
            const publicPlanPayload = buildPublicPlanMessagePayload({
                agentTaskPublicPlanExecutionRequest: options?.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanControlledRun: options?.agentTaskPublicPlanControlledRun
            });
            const cleanedContent = cleanResponseContent(content);
            if (!hasVisibleAssistantPayload({
                content: cleanedContent,
                image: options?.image,
                thinkingSteps: options?.thinkingSteps,
                executionSummary: options?.executionSummary,
                agentTaskPlanPresentation: options?.agentTaskPlanPresentation,
                businessVisualObservationFeedback: options?.businessVisualObservationFeedback,
                agentTaskPublicPlanExecutionRequest: publicPlanPayload.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanControlledRun: publicPlanPayload.agentTaskPublicPlanControlledRun,
                skuDeliverySummary: options?.skuDeliverySummary,
                interactiveCards: options?.interactiveCards
            })) {
                return false;
            }
            updateAssistantMessageWithOrigin(streamedAssistantMessageId, {
                content: cleanedContent,
                image: options?.image,
                thinkingSteps: options?.thinkingSteps,
                executionSummary: options?.executionSummary,
                agentTaskPlanPresentation: options?.agentTaskPlanPresentation,
                agentRequestLifecycle: options?.agentRequestLifecycle,
                agentDiagnosticRecord: options?.agentDiagnosticRecord,
                businessVisualObservationFeedback: options?.businessVisualObservationFeedback,
                agentTaskPlan: options?.agentTaskPlan,
                agentTaskPublicPlan: options?.agentTaskPublicPlan,
                agentTaskPublicPlanExecutionRequest: publicPlanPayload.agentTaskPublicPlanExecutionRequest,
                agentTaskPublicPlanApprovalRecord: options?.agentTaskPublicPlanApprovalRecord,
                agentTaskPublicPlanControlledRun: publicPlanPayload.agentTaskPublicPlanControlledRun,
                skuDeliverySummary: options?.skuDeliverySummary,
                interactiveCards: options?.interactiveCards,
                pendingInteractiveContinuation: options?.pendingInteractiveContinuation,
                conversationalModelFailure: options?.conversationalModelFailure,
                isThinking: false
            }, options?.assistantReplyOrigin || uiStatusReplyOrigin('agent-stream:final-missing-origin'), runConversationId);
            cachePrivatePublicPlanOperationRequests(streamedAssistantMessageId, options?.agentTaskPublicPlanExecutionRequest);
            return true;
        };
        
        try {
            throwIfRunStopped();
            // 先完成可能较慢的项目读取并复核提交时项目身份，避免它消耗 Photoshop 基线的短 TTL。
            const projectContext = await getProjectContext({
                expectedProjectPresent: Boolean(submissionProject),
                expectedProjectId: submissionProjectId || undefined,
                expectedProjectPath: submissionProjectPath || undefined,
                selectedProjectImagePath: submissionSelectedAssetContext?.path
            });
            throwIfRunStopped();

            // Photoshop 环境事实必须在项目读取后、快照冻结前最后采集。
            // 连接状态来自主进程 WebSocket，而不是可能滞后的 React Store；文档与活动图层来自同一次 Host 观察。
            const photoshopRequestContext = await capturePhotoshopRequestContext({ signal });
            throwIfRunStopped();
            const photoshopContext = photoshopRequestContext.context;
            const capturedAt = new Date().toISOString();
            const operatingContextSnapshot = buildOperatingContextSnapshot({
                snapshotId: `operating:${runId}`,
                capturedAt,
                correlationId: runId,
                workspace: {
                    source: 'design-agent-workbench+project-context',
                    observedAt: submissionWorkspaceObservedAt,
                    revision: buildOperatingWorkspaceRevision({
                        projectId: projectContext?.projectId || submissionProjectId,
                        projectPath: projectContext?.projectPath || submissionProjectPath,
                        activePage: submissionActiveWorkspacePage,
                        workflowRevision: submissionWorkflowContext?.revision,
                        selectedWorkflowNodeId: submissionWorkflowContext?.selectedNode?.nodeId,
                        selectedAssetPath: submissionSelectedAssetContext?.path,
                        selectedLibraryAssetId: submissionSelectedEagleLibraryAsset
                            ? `${submissionSelectedEagleLibraryAsset.libraryId}:${submissionSelectedEagleLibraryAsset.itemId}`
                            : submissionSelectedEagleAssetGroup
                                ? `group:${submissionSelectedEagleAssetGroup.map((ref) => ref.itemId).join(',')}`
                                : undefined,
                        knowledgeBindingRefs: submissionKnowledgeReferences.map((reference) => reference.bindingRef)
                    }),
                    activePage: submissionActiveWorkspacePage,
                    project: {
                        projectId: projectContext?.projectId || submissionProjectId || undefined,
                        projectName: projectContext?.projectName || submissionProjectName || undefined,
                        projectPath: projectContext?.projectPath || submissionProjectPath || undefined
                    },
                    ...(submissionSelectedAssetContext ? {
                        selectedAsset: {
                            path: submissionSelectedAssetContext.path,
                            name: submissionSelectedAssetContext.name
                        }
                    } : {}),
                    ...(submissionSelectedEagleLibraryAsset ? {
                        selectedLibraryAsset: submissionSelectedEagleLibraryAsset
                    } : {}),
                    ...(submissionSelectedEagleAssetGroup ? {
                        selectedLibraryAssetGroup: submissionSelectedEagleAssetGroup
                    } : {}),
                    ...(submissionWorkflowContext ? { workflow: submissionWorkflowContext } : {}),
                    ...(submissionKnowledgeReferences.length > 0 ? {
                        knowledgeReferences: submissionKnowledgeReferences
                    } : {})
                },
                photoshop: {
                    source: photoshopRequestContext.source,
                    observedAt: photoshopRequestContext.observedAt,
                    revision: photoshopRequestContext.revision,
                    connection: photoshopRequestContext.connection,
                    documentState: photoshopRequestContext.documentState,
                    ...(photoshopContext?.hasDocument && photoshopContext.documentId ? {
                        document: {
                            documentId: photoshopContext.documentId,
                            name: photoshopContext.documentName,
                            width: photoshopContext.canvasSize?.width,
                            height: photoshopContext.canvasSize?.height,
                            layerCount: photoshopContext.layerCount
                        }
                    } : {}),
                    ...(photoshopContext?.hasDocument && photoshopContext.activeLayerId ? {
                        activeLayer: {
                            layerId: photoshopContext.activeLayerId,
                            name: photoshopContext.activeLayerName
                        }
                    } : {})
                }
            });
            const stateForConversation = useAppStore.getState();
            const runConversation = runConversationId
                ? stateForConversation.conversations.find((conversation) => conversation.id === runConversationId)
                : undefined;
            const latestMessages = runConversation?.messages
                || (runConversationId === stateForConversation.currentConversationId
                    ? stateForConversation.messages
                    : []);
            const publicPlanConfirmationSourceMessage = runOptions?.publicPlanConfirmationSourceMessageId
                ? latestMessages.find(m => m.id === runOptions.publicPlanConfirmationSourceMessageId)
                : undefined;
            const sourcePublicPlanRequest = (publicPlanConfirmationSourceMessage as any)?.agentTaskPublicPlanExecutionRequest;
            const hasExplicitPublicPlanConfirmation = hasExplicitGeneratedPublicPlanApproval({
                sourceMessageId: runOptions?.publicPlanConfirmationSourceMessageId,
                sourceRequestStatus: sourcePublicPlanRequest?.status
            });
            const approvedWriteTools = Array.isArray(sourcePublicPlanRequest?.proposedWriteTools)
                ? sourcePublicPlanRequest.proposedWriteTools.filter((toolName: string) =>
                    Array.isArray(sourcePublicPlanRequest.allowedWriteTools)
                        && sourcePublicPlanRequest.allowedWriteTools.includes(toolName)
                )
                : [];
            const runtimePublicPlanLiveAdapterApproval = sourcePublicPlanRequest?.status === 'blocked_pending_user_confirmation'
                ? buildRuntimePublicPlanLiveAdapterApproval({
                    enabled: runOptions?.publicPlanDisposableLiveAdapter,
                    executeTool: executeToolCall,
                    projectPath: projectContext?.projectPath
                })
                : {};
            const agentTaskPublicPlanApproval = hasExplicitPublicPlanConfirmation
                ? {
                    userConfirmed: true,
                    allowedWriteTools: approvedWriteTools,
                    enableControlledExecutionRequest: true,
                    requestId: sourcePublicPlanRequest.requestId || runOptions?.publicPlanConfirmationSourceMessageId,
                    sourceMessageId: runOptions?.publicPlanConfirmationSourceMessageId,
                    runtimeOperationRequests: runOptions?.publicPlanConfirmationSourceMessageId
                        ? publicPlanPrivateOperationRequestsRef.current[runOptions.publicPlanConfirmationSourceMessageId]
                        : undefined,
                    ...runtimePublicPlanLiveAdapterApproval
                }
                : undefined;
            
            // 构建 Agent 上下文
            const agentContext: AgentContext = {
                userInput,
                requestId: runId,
                conversationId: runConversationId || undefined,
                interactiveContinuationRequest: runOptions?.interactiveContinuationRequest,
                conversationHistory: latestMessages
                    .filter(shouldIncludeMessageInAgentConversationHistory)
                    .map(m => ({
                        id: m.id,
                        role: m.role,
                        content: typeof m.content === 'string' ? m.content : '',
                        agentRequestLifecycle: m.agentRequestLifecycle,
                        executionSummary: m.executionSummary,
                        agentTaskPlan: m.agentTaskPlan,
                        agentTaskPublicPlan: m.agentTaskPublicPlan,
                        agentTaskPublicPlanExecutionRequest: m.agentTaskPublicPlanExecutionRequest,
                        agentTaskPublicPlanApprovalRecord: m.agentTaskPublicPlanApprovalRecord,
                        agentTaskPublicPlanControlledRun: m.agentTaskPublicPlanControlledRun,
                        interactiveCards: m.interactiveCards,
                        interactiveCardSubmissions: m.interactiveCardSubmissions,
                        pendingInteractiveContinuation: m.pendingInteractiveContinuation,
                        metadata: {
                            agentRequestLifecycle: m.agentRequestLifecycle,
                            executionSummary: m.executionSummary,
                            agentTaskPlan: m.agentTaskPlan,
                            agentTaskPublicPlan: m.agentTaskPublicPlan,
                            agentTaskPublicPlanExecutionRequest: m.agentTaskPublicPlanExecutionRequest,
                            agentTaskPublicPlanApprovalRecord: m.agentTaskPublicPlanApprovalRecord,
                            agentTaskPublicPlanControlledRun: m.agentTaskPublicPlanControlledRun,
                            interactiveCardSubmissions: m.interactiveCardSubmissions,
                            pendingInteractiveContinuation: m.pendingInteractiveContinuation
                        }
                    })),
                isPluginConnected: resolveOperatingPhotoshopConnection(operatingContextSnapshot),
                photoshopContext,
                projectContext,
                operatingContextSnapshot,
                designDimensionSpec,
                agentTaskPublicPlanApproval,
                resumeReadonlyToolHandlers: buildAgentResumeReadonlyToolHandlers({
                    executeToolCall,
                    projectContext
                }),
                hasAttachedImage,  // 传递图片状态
                attachedImageData: attachedImages[0]?.data,
                attachedImages,
                providerNativeWebSearchIntent: runOptions?.providerNativeWebSearchIntent
            };

            const buildRequestNativeToolsForModel = (modelId: string, options?: any): ProviderNativeToolRequest[] => {
                if (!canAttachProviderNativeWebSearchToModelCall(options)) return [];
                const requestWebSearchIntent = runOptions?.providerNativeWebSearchIntent;
                const providerNativeIntent = toProviderNativeWebSearchIntent(
                    requestWebSearchIntent,
                    useAppStore.getState().designKnowledgeSettings || designKnowledgeSettings
                );
                if (!providerNativeIntent) return [];
                const model = getModelById(modelId);
                if (!model) return [];
                const plan = buildProviderNativeToolPlan({
                    provider: model.provider,
                    modelId: model.apiModelId || model.id,
                    requestedTools: [providerNativeIntent]
                });
                return plan.status === 'ready' ? plan.nativeTools : [];
            };

            // 调用模型的封装函数（支持图片 + 模型竞速优化）
            const callModel = async (msgs: Array<{ role: string; content: string | any[] }>, options?: any) => {
                const isRouterCall = options?.purpose === 'router' || options?.silent === true;
                const isVisibleReasoningCall = options?.purpose === 'visible_reasoning';
                const isDirectResponseCall = options?.purpose === 'direct_response';
                const isDirectResponseLikeCall = isDirectResponseCall || options?.purpose === 'direct_response_repair';
                const deferVisibleStream = options?.deferVisibleStream === true;
                const shouldUseAttachedImages = hasAttachedImage && options?.includeAttachedImages !== false;
                const taskType: ConversationTaskType = resolveConversationTaskTypeForModelPurpose({
                    userInput,
                    hasImage: shouldUseAttachedImages,
                    purpose: options?.purpose,
                    silent: options?.silent === true
                });
                const latestModelState = useAppStore.getState();
                const latestModelPreferences = latestModelState.modelPreferences || modelPreferences;
                const latestApiKeys = latestModelState.apiKeys || {};
                const getLivePriorityForTask = (modelTaskType: ConversationTaskType) =>
                    getModelPriorityForConversationTask(latestModelPreferences, modelTaskType, {
                        apiKeys: latestApiKeys
                    });
                const getLiveRecoveryPriorityForTask = (modelTaskType: ConversationTaskType) =>
                    getModelRecoveryPriorityForConversationTask(latestModelPreferences, modelTaskType, {
                        apiKeys: latestApiKeys
                    });
                // 自动降级关闭时「只使用用户设置的模型」：不并入 recovery 候选。
                // recovery 列表硬编码 includeFallback:true（model-selection.ts getModelRecoveryPriorityForConversationTask），
                // 会把用户从没在能力槽配过的 configured-cloud-backups / 跨任务备份拉进候选逐个静默尝试
                // （实测命中 gptsapi-* 等，日志 401 余额不足）。autoFallback=true 时维持原有 recovery 行为不变。
                const autoFallbackEnabled = latestModelPreferences?.autoFallback === true;
                const getRecoveryForTaskWhenAllowed = (modelTaskType: ConversationTaskType) =>
                    autoFallbackEnabled ? getLiveRecoveryPriorityForTask(modelTaskType) : [];
                let modelsToTry = uniqueModelIds([
                    ...getLivePriorityForTask(taskType),
                    ...getRecoveryForTaskWhenAllowed(taskType)
                ]);
                if (isDirectResponseLikeCall && !shouldUseAttachedImages) {
                    modelsToTry = uniqueModelIds([
                        ...getLivePriorityForTask('general'),
                        ...getLivePriorityForTask('copywriting'),
                        ...getRecoveryForTaskWhenAllowed('general'),
                        ...getRecoveryForTaskWhenAllowed('copywriting'),
                        ...modelsToTry
                    ]);
                }
                if (canAttachProviderNativeWebSearchToModelCall(options)) {
                    modelsToTry = uniqueModelIds([
                        ...getProviderNativeWebSearchModelPriority(latestApiKeys),
                        ...modelsToTry
                    ]);
                }
                agentLog(
                    'info',
                    `[ModelRouting] 候选模型 ${taskType}/${options?.purpose || 'chat'}: ${modelsToTry.slice(0, 8).join(', ')}${modelsToTry.length > 8 ? ` +${modelsToTry.length - 8}` : ''}`
                );
                const modelCandidateOffset = Number(options?.modelCandidateOffset);
                if (modelsToTry.length > 1 && Number.isFinite(modelCandidateOffset) && modelCandidateOffset > 0) {
                    const offset = Math.round(modelCandidateOffset) % modelsToTry.length;
                    modelsToTry = [
                        ...modelsToTry.slice(offset),
                        ...modelsToTry.slice(0, offset)
                    ];
                    agentLog(
                        'info',
                        `[ModelRouting] 本次按候选偏移 ${offset} 重排：${modelsToTry.slice(0, 8).join(', ')}${modelsToTry.length > 8 ? ` +${modelsToTry.length - 8}` : ''}`
                    );
                }
                const modelTimeoutMs = typeof options?.timeoutMs === 'number'
                    ? options.timeoutMs
                    : (isRouterCall || isVisibleReasoningCall || isDirectResponseLikeCall ? 15_000 : undefined);
                const modelErrors: string[] = [];
                const recordModelFailure = (modelId: string, reason: unknown) => {
                    const message = compactModelFailureText(reason) || 'model call failed';
                    modelErrors.push(`${modelId}: ${message}`);
                    agentLog('warn', `[ModelRouting] 模型 ${modelId} 不可用，尝试下一个候选: ${message.slice(0, 220)}`);
                };
                
                if (shouldUseAttachedImages && !isRouterCall && !isVisibleReasoningCall) {
                    console.log('[ChatPanel] 📷 有附带图片，使用视觉模型:', modelsToTry.slice(0, 3).join(', '));
                    console.log('[ChatPanel] 📷 附带图片信息:', {
                        count: attachedImages.length,
                        hasData: !!attachedImages[0]?.data,
                        dataLength: attachedImages[0]?.data?.length,
                        type: attachedImages[0]?.mediaType,
                        msgCount: msgs.length
                    });
                    msgs = injectImagesIntoLastUserMessage(msgs, attachedImages);
                }
                
                // 按顺序尝试模型列表
                for (const modelId of modelsToTry) {
                    throwIfRunStopped();
                    const nativeTools = buildRequestNativeToolsForModel(modelId, options);
                    const modelRequestOptions = {
                        maxTokens: options?.maxTokens,
                        temperature: options?.temperature,
                        thinkingEnabled: resolveModelThinkingEnabledForCall(modelId, latestModelPreferences),
                        ...(nativeTools.length > 0 ? { nativeTools } : {})
                    };
                    if (nativeTools.length > 0) {
                        markProviderNativeWebSearchStarted();
                    }
                    
                    try {
                        const streamHasAttachedImage = isVisibleReasoningCall ? false : shouldUseAttachedImages;
                        if (!isRouterCall && canUsePlainTextProviderStream(msgs, options, {
                            hasAttachedImage: streamHasAttachedImage,
                            hasToolCalling: false
                        }) && nativeTools.length === 0) {
                            const streamOptions = {
                                maxTokens: options?.maxTokens,
                                temperature: options?.temperature,
                                thinkingEnabled: resolveModelThinkingEnabledForCall(modelId, latestModelPreferences),
                                timeoutMs: modelTimeoutMs
                            };
                            let streamedContentFromCall = '';
                            let streamError: unknown = null;

                            try {
                                const response = await streamChatAsync(
                                    modelId,
                                    msgs.map(message => ({
                                        role: message.role,
                                        content: String(message.content)
                                    })),
                                    {
                                        ...streamOptions,
                                        onProgress: (fullContent) => {
                                            streamedContentFromCall = fullContent;
                                            if (!canApplyRunUpdate()) return;
                                            if (isVisibleReasoningCall) {
                                                updateStreamedVisibleReasoning(fullContent);
                                            } else if (!deferVisibleStream) {
                                                updateStreamedAssistantContent(fullContent, {
                                                    source: 'provider-visible-token-stream',
                                                    modelId,
                                                    isThinking: true
                                                });
                                            }
                                        },
                                        onThinkingProgress: (fullThinking) => {
                                            if (!canApplyRunUpdate()) return;
                                            if (!fullThinking.trim()) return;
                                            if (isVisibleReasoningCall) return;
                                            if (streamOptions.thinkingEnabled !== true) return;
                                            updateStreamedVisibleReasoning(fullThinking);
                                        }
                                    }
                                );
                                throwIfRunStopped();

                                if (streamedThinkingStepId) {
                                    updateStep(streamedThinkingStepId, { status: 'success' });
                                }

                                const streamedText = String(response?.text || streamedContentFromCall || '').trim();
                                if (streamedText) {
                                    const streamedFailure = extractModelCallFailureMessage({
                                        ...response,
                                        text: streamedText
                                    });
                                    if (streamedFailure) {
                                        recordModelFailure(modelId, streamedFailure);
                                        continue;
                                    }
                                    console.log(`[ChatPanel] ✓ 模型 ${modelId} 流式调用成功`);
                                    return {
                                        text: streamedText,
                                        thinking: isDirectResponseLikeCall || isVisibleReasoningCall ? undefined : response?.thinking
                                    };
                                }
                            } catch (error) {
                                if (!canApplyRunUpdate() || signal.aborted || (error instanceof Error && error.message === '任务已取消')) {
                                    throw error;
                                }
                                streamError = error;
                                console.warn(`[ChatPanel] 模型 ${modelId} 流式调用失败，尝试非流式补救:`, error);
                            }

                            const fallbackResponse = await window.designEcho.chat(modelId, msgs, {
                                ...modelRequestOptions,
                                timeoutMs: modelTimeoutMs
                            });
                            throwIfRunStopped();
                            const fallbackFailure = extractModelCallFailureMessage(fallbackResponse);
                            if (fallbackFailure) {
                                recordModelFailure(modelId, fallbackFailure);
                                continue;
                            }
                            if (fallbackResponse?.text) {
                                console.log(`[ChatPanel] ✓ 模型 ${modelId} 流式为空或失败，非流式补救成功`);
                                return {
                                    ...fallbackResponse,
                                    thinking: isDirectResponseLikeCall || isVisibleReasoningCall ? undefined : fallbackResponse?.thinking
                                };
                            }

                            const streamErrorMessage = streamError instanceof Error
                                ? streamError.message
                                : streamError
                                    ? String(streamError)
                                    : 'empty stream response';
                            modelErrors.push(`${modelId}: ${streamErrorMessage}`);
                            continue;
                        }

                        const response = await window.designEcho.chat(modelId, msgs, {
                            ...modelRequestOptions,
                            timeoutMs: modelTimeoutMs
                        });
                        throwIfRunStopped();
                        const responseFailure = extractModelCallFailureMessage(response);
                        if (responseFailure) {
                            recordModelFailure(modelId, responseFailure);
                            continue;
                        }
                        if (response?.text) {
                            if (nativeTools.length > 0) {
                                markProviderNativeWebSearchCompleted(response);
                            }
                            console.log(`[ChatPanel] ✓ 模型 ${modelId} 调用成功`);
                            return {
                                ...response,
                                thinking: isDirectResponseLikeCall || isVisibleReasoningCall ? undefined : response?.thinking
                            };
                        }
                        modelErrors.push(`${modelId}: empty response`);
                    } catch (error) {
                        if (!canApplyRunUpdate() || signal.aborted || (error instanceof Error && error.message === '任务已取消')) {
                            throw error;
                        }
                        console.warn(`[ChatPanel] 模型 ${modelId} 调用失败:`, error);
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        modelErrors.push(`${modelId}: ${errorMessage}`);
                        // 继续尝试下一个模型
                    }
                }
                
                console.warn('[ChatPanel] ⚠️ 所有模型调用失败');
                markProviderNativeWebSearchFailed();
                const mergedError = Array.from(new Set(modelErrors)).slice(0, 3).join(' | ');
                throw new Error(mergedError || '所有模型调用失败');
            };
            (callModel as any).supportsModelMediatedUserReply = true;
            
            // 追踪是否已收到思维内容
            let hasReceivedThinking = false;
            
            // 检查是否已取消
            if (signal.aborted) {
                throw new Error('任务已取消');
            }

            // 执行统一 Agent 处理（只接收真实模型反馈和执行事件）
            setLiveActivity(current => buildVisibleAgentActivityFromRunPhase('agent_processing', current));
            const result = await processWithUnifiedAgent(agentContext, {
                callModel,
                signal,  // 传递取消信号
                callbacks: {
                    onStep: (event) => {
                        if (!canApplyRunUpdate()) return;
                        handleAgentStep(event);
                    },
                    onTaskPlanPresentation: (presentation) => {
                        if (!canApplyRunUpdate()) return;
                        const expectedProjectId = String(
                            operatingContextSnapshot.workspace.project?.projectId
                            || submissionProjectId
                            || 'workspace:none'
                        ).trim();
                        if (runConversationId
                            && presentation.identity.conversationId !== runConversationId) {
                            return;
                        }
                        if (presentation.identity.projectId !== expectedProjectId) return;

                        if (!streamedAssistantMessageId) {
                            streamedAssistantMessageId = addRunAssistantMessage({
                                content: '',
                                agentTaskPlanPresentation: presentation,
                                isThinking: true
                            }, uiStatusReplyOrigin('agent-task-plan:runtime-projection'));
                            if (activeAgentRunUiRef.current?.runId === runId) {
                                activeAgentRunUiRef.current.streamedAssistantMessageId = streamedAssistantMessageId;
                            }
                            return;
                        }

                        updateRunAssistantMessage(
                            streamedAssistantMessageId,
                            { agentTaskPlanPresentation: presentation },
                            uiStatusReplyOrigin('agent-task-plan:runtime-projection')
                        );
                    },
                    onSnapshotImage: (snapshot) => {
                        // 把 Agent 看过的画面快照内联到「判断与处理」步骤流（而非独立对话消息），
                        // 让用户在思考/处理过程中就近看到「Agent 看到的是什么」，位置更贴合上下文。
                        if (!canApplyRunUpdate()) return;
                        if (!snapshot?.data) return;
                        const snapshotDataUrl = snapshot.data.startsWith('data:')
                            ? snapshot.data
                            : `data:${snapshot.mediaType || 'image/jpeg'};base64,${snapshot.data}`;
                        addStep({
                            type: 'analyzing',
                            content: `看到当前画面（${snapshot.toolName} · 第 ${snapshot.index} 张）`,
                            status: 'success',
                            imageData: snapshotDataUrl
                        });
                    },
                    onProgress: (message, percent) => {
                        if (!canApplyRunUpdate()) return;
                        agentLog('info', `[AI Agent] ${message} (${percent}%)`);
                        setLiveActivity(current => buildVisibleAgentActivityFromProgress(message, current));
                    },
                    onStatus: (message) => {
                        if (!canApplyRunUpdate()) return;
                        const content = String(message || '').trim();
                        if (!content) return;
                        agentLog('info', `[AI Agent] 状态: ${content}`);
                    },
                    onMessage: (message) => {
                        if (!canApplyRunUpdate()) return;
                        if (message && message.trim()) {
                            agentLog('info', `[AI Agent] 📌 进展: ${message.substring(0, 100)}...`);
                            setLiveActivity(current => buildVisibleAgentActivityFromProgress(message, current));
                        }
                    },
                    onToolStart: (toolName) => {
                        if (!canApplyRunUpdate()) return;
                        agentLog('info', `[AI Agent] 执行工具: ${toolName}`);
                        if (hasStructuredToolEvents) return;
                        
                        // 标记思维完成（工具开始执行说明思维阶段结束）
                        if (!hasReceivedThinking && thinkingStepId) {
                            const currentStep = collectedSteps.find(s => s.id === thinkingStepId);
                            if (currentStep && currentStep.status === 'running') {
                                updateStep(thinkingStepId, { status: 'success' });
                            }
                        }
                        
                        // 添加工具调用步骤
                        const toolInfo = getToolDisplayInfo(toolName);
                        addStep({
                            type: 'tool_call',
                            content: `执行 ${toolInfo.name}`,
                            toolName: toolName,
                            status: 'running'
                        });
                    },
                    onToolComplete: (toolName, toolResult) => {
                        if (!canApplyRunUpdate()) return;
                        agentLog('info', `[AI Agent] 工具完成: ${toolName}`, toolResult);
                        
                        // 找到对应的工具步骤并更新（保留原始 content，只更新状态）
                        const toolStep = hasStructuredToolEvents
                            ? collectedSteps.slice().reverse().find(s => s.toolName === toolName && !s.toolResult)
                            : collectedSteps.find(s => s.toolName === toolName && s.status === 'running');
                        if (toolStep) {
                            updateStep(toolStep.id, {
                                status: toolResult?.success !== false ? 'success' : 'error',
                                // 保留原始工具描述，不用 "完成" 覆盖
                                toolResult: toolResult
                            });
                        }
                    },
                    onThinking: (thinking, meta) => {
                        if (!canApplyRunUpdate()) return;
                        if (hasVisibleStreamedAssistantContent) return;
                        const visibleThinking = sanitizeUserVisibleThinkingText(thinking);
                        if (!visibleThinking) return;
                        const observation = classifyAgentObservationChannel({
                            source: meta?.source || 'model_visible_reasoning',
                            content: visibleThinking
                        });
                        // 只有 provider thinking 或模型公开推理摘要允许进入“正在思考”。
                        if (canObservationEnterThinkingSteps(observation)) {
                            hasReceivedThinking = true;
                            agentLog('info', `[AI Agent] 💡 思维过程: ${visibleThinking.substring(0, 200)}...`);
                        
                            // 更新初始思考步骤
                            console.log('[ChatPanel] 💡 更新思维步骤 (from thinking):', { thinkingStepId, thinking: visibleThinking.substring(0, 50) });
                            const targetThinkingStepId = thinkingStepId || streamedThinkingStepId;
                            if (!targetThinkingStepId) {
                                thinkingStepId = addStep({
                                    type: 'thinking',
                                    content: visibleThinking,
                                    status: 'running'
                                });
                            } else {
                                thinkingStepId = targetThinkingStepId;
                                const currentStep = collectedSteps.find(s => s.id === targetThinkingStepId);
                                const isProviderThinkingSnapshot = meta?.source === 'provider_thinking_delta'
                                    || meta?.source === 'provider_final_thinking';
                                updateStep(targetThinkingStepId, {
                                    type: 'thinking',
                                    content: isProviderThinkingSnapshot
                                        ? visibleThinking
                                        : mergeVisibleThinking(currentStep?.content || '', visibleThinking),
                                    status: 'running'
                                });
                            }
                        }
                    }
                }
            });
            const resultWasCancelled = (result as any).cancelled === true;
            const resultDisposition = decideAgentRunResultDisposition({
                isActiveRun: isActiveAgentRun(),
                runCancelled: isRunCancelled(),
                resultCancelled: resultWasCancelled
            });
            if (resultDisposition === 'ignore_stale_result') return;
            if (resultDisposition === 'reject_result_after_stop') {
                throw new Error('任务已取消');
            }
            
            // 计算处理时长
            const processingTime = Date.now() - thinkingStartTime;
            const hasToolExecution = result.toolResults && result.toolResults.length > 0;
            const executionSummary = readAgentExecutionSummaryFromResult(result);
            const resolvedVisibleResult = resolveAgentResultVisibleMessage(result);
            const resultVisibleMessage = resolvedVisibleResult.content;
            const assistantReplyOrigin = resolvedVisibleResult.assistantReplyOrigin;
            const agentRequestLifecycle = (result as any).data?.agentRequestLifecycle as AgentRequestLifecycleRecord | undefined;
            const agentDiagnosticRecord = buildAgentDiagnosticRecord((result as any).data);
            const businessVisualObservationFeedback = (result as any).data?.businessVisualObservationFeedback as BusinessSkillVisualObservationFeedback | undefined;
            const agentTaskPlan = (result as any).data?.agentTaskPlan;
            const runtimeResultData = (result as any).data;
            const hasRuntimeTaskSnapshot = Boolean(runtimeResultData)
                && Object.prototype.hasOwnProperty.call(runtimeResultData, 'runtimeTaskSnapshot');
            const runtimeTaskSnapshot = hasRuntimeTaskSnapshot
                ? readRuntimeTaskSnapshot(runtimeResultData.runtimeTaskSnapshot)
                : undefined;
            const agentTaskPlanPresentation = buildAgentTaskPlanPresentation({
                ...(hasRuntimeTaskSnapshot ? { runtimeTaskSnapshot: runtimeTaskSnapshot || null } : {}),
                taskPlan: agentTaskPlan,
                declaration: (result as any).data?.runtimeActionPlanDeclaration,
                reconciliation: (result as any).data?.runtimeActionPlanReconciliation,
                runtimeSessionDigest: (result as any).data?.runtimeSessionDigest,
                runtimeStageTrace: (result as any).data?.runtimeStageTrace,
                conversationId: runConversationId || undefined,
                projectId: operatingContextSnapshot.workspace.project?.projectId
                    || submissionProjectId
                    || 'workspace:none'
            });
            const agentTaskPublicPlan = (result as any).data?.agentTaskPublicPlan;
            const agentTaskPublicPlanExecutionRequest = (result as any).data?.agentTaskPublicPlanExecutionRequest;
            const agentTaskPublicPlanApprovalRecord = (result as any).data?.agentTaskPublicPlanApprovalRecord;
            const agentTaskPublicPlanControlledRun = (result as any).data?.agentTaskPublicPlanControlledRun;
            const skuDeliverySummary = (result as any).data?.skuDeliverySummary as SkuDeliverySummary | undefined;
            const interactiveCardsFromData = Array.isArray((result as any).data?.interactiveCards)
                ? (result as any).data.interactiveCards as InteractiveCardDefinition[]
                : [];
            const interactiveCardsFromTools = Array.isArray(result.toolResults)
                ? result.toolResults.flatMap((toolResult: any) => (
                    Array.isArray(toolResult?.result?.interactiveCards)
                        ? toolResult.result.interactiveCards
                        : []
                )) as InteractiveCardDefinition[]
                : [];
            const interactiveCards = [...interactiveCardsFromData, ...interactiveCardsFromTools]
                .filter((card) => card?.version === 'interactive-card/v0');
            const pendingInteractiveContinuation = (result as any).data
                ?.pendingInteractiveContinuation as PendingInteractiveContinuation | undefined;
            const conversationalModelFailure = (result as any).data?.conversationalModelFailure;

            if (!resultWasCancelled && runOptions?.publicPlanConfirmationSourceMessageId && agentTaskPublicPlanApprovalRecord) {
                if (runConversationId) {
                    updateMessageInConversation(runConversationId, runOptions.publicPlanConfirmationSourceMessageId, {
                        agentTaskPublicPlanApprovalRecord
                    } as any);
                } else {
                    updateMessage(runOptions.publicPlanConfirmationSourceMessageId, {
                        agentTaskPublicPlanApprovalRecord
                    } as any);
                }
            }
            
            // 只有正常返回才把剩余步骤收为完成；用户停止不能伪装成执行成功。
            if (!resultWasCancelled) {
                collectedSteps.forEach(step => {
                    if (step.status === 'running') {
                        updateStep(step.id, { status: 'success' });
                    }
                });
            }
            
            // 隐藏实时反馈（将显示在消息中）
            setShowThinking(false);
            setLiveActivity(null);
            
            // 检查是否是用户取消（优先处理）
            if (resultWasCancelled) {
                console.log('[AI Agent] 用户主动停止');
                finalizeAgentRunStopped(runId, 'agent-run:cancelled-result', {
                    executionSummary,
                    agentTaskPlanPresentation
                });
            } else if (result.success) {
                let responseContent = resultVisibleMessage;
                let generatedImage: { data: string; type: string } | undefined;
                const businessVisualFeedbackContent = formatAssistantBusinessVisualFeedbackContent({
                    message: responseContent,
                    businessVisualObservationFeedback
                });
                if (businessVisualFeedbackContent) {
                    responseContent = businessVisualFeedbackContent;
                }
                
                // 如果有工具结果，格式化显示
                if (hasToolExecution) {
                    // 检查是否有图片生成结果
                    const imageGenResult = result.toolResults!.find(tr => 
                        tr.toolName === 'generateImage' && tr.result?.imageData
                    );
                    if (imageGenResult?.result?.imageData) {
                        generatedImage = {
                            data: imageGenResult.result.imageData,
                            type: 'image/png'
                        };
                        responseContent = imageGenResult.result.message || resultVisibleMessage;
                    }
                }
                
                // 添加消息（仅包含真实模型反馈或真实工具事件）。
                // 普通聊天不保存固定系统日志，避免把硬编码流程包装成模型思考。
                const visibleProcessSteps = collectedSteps.filter(
                    step => shouldPersistVisibleProcessStep(step, agentRequestLifecycle)
                );
                const hasVisibleProcessSteps = visibleProcessSteps.length > 0;
                const stepsToSave = hasVisibleProcessSteps
                    ? normalizePersistedVisibleProcessSteps(visibleProcessSteps)
                    : undefined;
                if (!hasVisibleAssistantPayload({
                    content: responseContent,
                    image: generatedImage,
                    thinkingSteps: stepsToSave,
                    executionSummary,
                    agentTaskPlanPresentation,
                    businessVisualObservationFeedback,
                    agentTaskPublicPlanExecutionRequest,
                    agentTaskPublicPlanControlledRun,
                    skuDeliverySummary,
                    interactiveCards
                })) {
                    responseContent = buildMissingVisibleResultContent(agentTaskPlan);
                }
                
                // 使用打字机效果显示最终回复
                if (!finalizeStreamedAssistantMessage(responseContent, {
                    image: generatedImage,
                    thinkingSteps: stepsToSave,
                    executionSummary,
                    agentTaskPlanPresentation,
                    assistantReplyOrigin,
                    agentRequestLifecycle,
                    agentDiagnosticRecord,
                    businessVisualObservationFeedback,
                    agentTaskPlan,
                    agentTaskPublicPlan,
                    agentTaskPublicPlanExecutionRequest,
                    agentTaskPublicPlanApprovalRecord,
                    agentTaskPublicPlanControlledRun,
                    skuDeliverySummary,
                    interactiveCards,
                    pendingInteractiveContinuation,
                    conversationalModelFailure
                })) {
                    await displayAssistantMessage(responseContent, {
                        image: generatedImage,
                        thinkingSteps: stepsToSave,
                        executionSummary,
                        agentTaskPlanPresentation,
                        assistantReplyOrigin,
                        agentRequestLifecycle,
                        agentDiagnosticRecord,
                        businessVisualObservationFeedback,
                        agentTaskPlan,
                        agentTaskPublicPlan,
                        agentTaskPublicPlanExecutionRequest,
                        agentTaskPublicPlanApprovalRecord,
                        agentTaskPublicPlanControlledRun,
                        skuDeliverySummary,
                        interactiveCards,
                        pendingInteractiveContinuation,
                        conversationalModelFailure
                    });
                }
                
                console.log(`[AI Agent] ✅ 完成，耗时 ${(processingTime/1000).toFixed(1)}s，思维步骤: ${collectedSteps.length}`);
                } else {
                const formattedFailureContent = formatFailureContent(
                    resultVisibleMessage,
                    result.error,
                    executionSummary,
                    businessVisualObservationFeedback
                );
                const failureContent = sanitizeUserVisibleAssistantBodyText(formattedFailureContent).trim()
                    || buildFallbackFailureContent(businessVisualObservationFeedback, agentTaskPlan, executionSummary);
                const visibleFailureSteps = collectedSteps.filter(
                    step => shouldPersistVisibleProcessStep(step, agentRequestLifecycle)
                );
                const failureStepsToSave = normalizePersistedVisibleProcessSteps(
                    filterRedundantFailureProcessSteps(visibleFailureSteps, failureContent)
                );
                if (!finalizeStreamedAssistantMessage(failureContent, {
                    thinkingSteps: failureStepsToSave,
                    executionSummary,
                    agentTaskPlanPresentation,
                    assistantReplyOrigin,
                    agentRequestLifecycle,
                    agentDiagnosticRecord,
                    businessVisualObservationFeedback,
                    agentTaskPlan,
                    agentTaskPublicPlan,
                    agentTaskPublicPlanExecutionRequest,
                    agentTaskPublicPlanApprovalRecord,
                    agentTaskPublicPlanControlledRun,
                    skuDeliverySummary,
                    interactiveCards,
                    pendingInteractiveContinuation,
                    conversationalModelFailure
                })) {
                    addRunAssistantMessage({
                        content: failureContent,
                        thinkingSteps: failureStepsToSave,
                        executionSummary,
                        agentTaskPlanPresentation,
                        agentRequestLifecycle,
                        agentDiagnosticRecord,
                        businessVisualObservationFeedback,
                        agentTaskPlan,
                        agentTaskPublicPlan,
                        agentTaskPublicPlanExecutionRequest,
                        agentTaskPublicPlanApprovalRecord,
                        agentTaskPublicPlanControlledRun,
                        skuDeliverySummary,
                        interactiveCards,
                        pendingInteractiveContinuation,
                        conversationalModelFailure
                    }, assistantReplyOrigin || uiStatusReplyOrigin('agent-run:failure-result'));
                }
            }
            
            // 清理思维步骤状态
            clearThinkingSteps();
            
        } catch (error: any) {
            console.error('[AI Agent] 处理失败:', error);
            // 注意：不再调用 removeLastMessage，因为现在没有添加 loading 消息
            
            // 检查是否是用户取消
            if (error.message === '任务已取消' || signal.aborted || cancelledAgentRunIdsRef.current.has(runId) || !isActiveAgentRun()) {
                console.log('[AI Agent] 任务已被用户取消');
                finalizeAgentRunStopped(runId, 'agent-run:cancelled-exception');
                return;
            }

            if (!canApplyRunUpdate()) {
                return;
            }
            
            // 标记所有运行中的步骤为错误
            collectedSteps.forEach(step => {
                if (step.status === 'running') {
                    updateStep(step.id, { status: 'error' });
                }
            });
            
            // 隐藏实时反馈
            setShowThinking(false);
            setLiveActivity(null);
            clearThinkingSteps();
            
            // 构建脱敏错误摘要。保留 quota / 429 / 鉴权等真实原因，不回退成笼统失败。
            const prefs = useAppStore.getState().modelPreferences;
            const isCloud = prefs?.mode === 'cloud';
            const errorMsg = summarizeChatError(error, { isCloud });
            
            const errorStepsToSave = normalizePersistedVisibleProcessSteps(collectedSteps.filter(isVisiblePonderingStep));
            if (!finalizeStreamedAssistantMessage(errorMsg, {
                thinkingSteps: errorStepsToSave,
                assistantReplyOrigin: uiStatusReplyOrigin('agent-run:error')
            })) {
                addRunAssistantMessage({
                    content: errorMsg,
                    thinkingSteps: errorStepsToSave
                }, uiStatusReplyOrigin('agent-run:error'));
            }
        } finally {
            // 清理 AbortController
            if (activeAgentRunIdRef.current === runId) {
                setAbortController(null);
            }
        }
    };

    // 旧的 handleNaturalChat 函数已废弃，由 handleUnifiedAgent 替代

    // [已移除] handleQuickTaskExecute 函数 - 快捷任务模板功能
    // [已移除] 硬编码快速操作按钮相关函数
    // 用户应通过自然语言与 Agent 交互实现：优化文案、分析排版、智能文案等功能
    // [已移除] 原快速操作函数 handleQuickAction, handleSmartCopywriting, formatQuickActionResult
    // 这些功能现在应该通过与 Agent 自然语言交互来实现
    /**
     * 工具测试 - 验证 UXP 插件连接
     */
    // [已移除] handleQuickAction, handleSmartCopywriting, formatQuickActionResult
    // 这些功能现在通过 Agent 自然语言交互实现

    /**
     * 工具测试 - 验证 UXP 插件连接
     */
    const handleToolTest = async () => {
        if (!isPluginConnected) {
            addLocalBlockerMessage('⚠️ 请先连接 Photoshop 插件后再进行工具测试。', 'tool-test:photoshop-disconnected');
            return;
        }

        setLoading(true);
        addLocalStatusMessage('🧪 开始工具验证测试...', 'tool-test:started');

        const results: string[] = [];
        const testTool = async (name: string, method: string, params: any = {}): Promise<boolean> => {
            try {
                const result = await window.designEcho.sendToPlugin(method, params);
                if (result.success !== false) {
                    results.push(`✅ ${name}: 成功`);
                    return true;
                } else {
                    results.push(formatUserVisibleFailureLine(name, result.error));
                    return false;
                }
            } catch (error: any) {
                results.push(formatUserVisibleFailureLine(name, error));
                return false;
            }
        };

        try {
            // 1. 测试文档信息获取
            await testTool('获取文档信息', 'getDocumentInfo');

            // 2. 测试获取所有文本图层
            await testTool('获取文本图层', 'getAllTextLayers');

            // 3. 测试获取选中图层文本
            await testTool('获取选中文本', 'getTextContent');

            // 4. 测试获取文本样式
            await testTool('获取文本样式', 'getTextStyle');

            // 5. 测试获取历史记录
            await testTool('获取历史记录', 'getHistoryInfo');

            // 6. 测试画布截图
            await testTool('画布截图', 'getDocumentSnapshot', { maxWidth: 200, maxHeight: 200 });

            // 统计结果
            const passed = results.filter(r => r.startsWith('✅')).length;
            const failed = results.filter(r => r.startsWith('❌')).length;

            let summary = `\n\n📊 **测试结果：** ${passed}/${results.length} 通过\n\n`;
            summary += results.join('\n');

            if (failed > 0) {
                summary += '\n\n💡 **提示：** 某些测试失败可能是因为没有选中图层或没有打开文档。请确保：\n1. 在 Photoshop 中打开了一个文档\n2. 选中了一个文本图层（用于文本相关测试）';
            } else {
                summary += '\n\n🎉 所有工具测试通过！';
            }

            addLocalAssistantMessage({
                content: summary
            }, toolSummaryReplyOrigin('tool-test:result'));

        } catch (error: any) {
            addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('测试过程中发生错误', error)
            }, toolSummaryReplyOrigin('tool-test:error'));
        } finally {
            setLoading(false);
        }
    };

    const handleDesktopDebug = async (rawCommand: string) => {
        const connectionStatus = await getPhotoshopConnectionStatus().catch(() => ({ connected: false, source: 'ipc' as const }));
        if (!connectionStatus.connected) {
            addLocalAssistantMessage({
                content: '⚠️ 桌面端联调需要先连接 Photoshop 插件。'
            }, deterministicBlockerReplyOrigin('desktop-debug:photoshop-disconnected'));
            return;
        }

        setLoading(true);
        addLocalAssistantMessage({
            content: '开始检查主图和详情页处理链路。'
        }, uiStatusReplyOrigin('desktop-debug:started'));

        try {
            const toolsResp = (await listPhotoshopMcpTools()) as PhotoshopMcpToolsListPayload;
            const tools = toolsResp?.tools || toolsResp?.result?.tools || [];
            const toolNames = new Set((tools || []).map((t: any) => t?.name).filter(Boolean));
            const requiredTools = ['getSubjectBounds', 'smartLayout', 'quickExport', 'parseDetailPageTemplate', 'fillDetailPage', 'exportDetailPageSlices'];
            const missingTools = requiredTools.filter((name) => !toolNames.has(name));

            const scenarios = rawCommand.toLowerCase().includes('quick')
                ? [
                    '请基于当前模板生成一版主图，突出价格和卖点',
                    '请优化当前详情页文案并自动适配换行'
                ]
                : [
                    '请基于当前模板生成一版主图，突出价格和卖点',
                    '请优化当前详情页文案并自动适配换行',
                    '把这组商品图应用到详情页模板并导出切片',
                    '再来一轮主图优化，输出800尺寸版本'
                ];

            const routeLines: string[] = [];
            for (const inputText of scenarios) {
                const decision = debugInferDecisionFromText(inputText);
                const target = decision.type === 'skill_execution'
                    ? '进入对应设计流程'
                    : decision.type === 'tool_call'
                        ? '直接处理画面'
                        : '只做判断说明';
                console.info('[desktop-debug:routing]', {
                    inputText,
                    type: decision.type,
                    skillId: decision.skillId,
                    toolNames: (decision.toolCalls || []).map((t) => t.toolName)
                });
                routeLines.push(`- ${inputText}\n  → ${target}`);
            }

            const findSubjectProbeLayerId = (layers: any[]): number | null => {
                for (const layer of layers || []) {
                    const id = Number(layer?.id);
                    const kind = String(layer?.kind || '').toLowerCase();
                    if (Number.isFinite(id) && id > 0 && kind !== 'group' && layer?.visible !== false) {
                        return Math.round(id);
                    }
                    const nested = findSubjectProbeLayerId(Array.isArray(layer?.children) ? layer.children : []);
                    if (nested) return nested;
                }
                return null;
            };

            const probeLines: string[] = [];
            let subjectProbeLayerId: number | null = null;

            try {
                const diagnosis = (await callPhotoshopMcpTool('diagnoseState', { verbose: false })) as PhotoshopMcpToolCallPayload;
                const failed = !!(diagnosis?.error || diagnosis?.isError === true || diagnosis?.success === false);
                probeLines.push(`${failed ? '未通过' : '通过'} Photoshop 状态检查`);
                console.info('[desktop-debug:diagnoseState]', { failed, error: (diagnosis as any)?.error });
            } catch (error: any) {
                probeLines.push(`未通过 Photoshop 状态检查`);
                console.info('[desktop-debug:diagnoseState]', { failed: true, error: error?.message || '调用异常' });
            }

            try {
                const hierarchy = (await callPhotoshopMcpTool('getLayerHierarchy', { includeHidden: false })) as PhotoshopMcpToolCallPayload;
                const failed = !!(hierarchy?.error || hierarchy?.isError === true || hierarchy?.success === false);
                const layers = Array.isArray((hierarchy as any)?.hierarchy) ? (hierarchy as any).hierarchy : [];
                subjectProbeLayerId = failed ? null : findSubjectProbeLayerId(layers);
                probeLines.push(`${failed ? '未通过' : '通过'} 图层结构检查`);
                console.info('[desktop-debug:getLayerHierarchy]', { failed, subjectProbeLayerId, error: (hierarchy as any)?.error });
            } catch (error: any) {
                probeLines.push(`未通过 图层结构检查`);
                console.info('[desktop-debug:getLayerHierarchy]', { failed: true, error: error?.message || '调用异常' });
            }

            if (subjectProbeLayerId) {
                try {
                    const subjectBounds = (await callPhotoshopMcpTool('getSubjectBounds', {
                        layerId: subjectProbeLayerId,
                        method: 'alpha'
                    })) as PhotoshopMcpToolCallPayload;
                    const failed = !!(subjectBounds?.error || subjectBounds?.isError === true || subjectBounds?.success === false);
                    probeLines.push(`${failed ? '未通过' : '通过'} 主体边界检查`);
                    console.info('[desktop-debug:getSubjectBounds]', { failed, subjectProbeLayerId, error: (subjectBounds as any)?.error });
                } catch (error: any) {
                    probeLines.push(`未通过 主体边界检查`);
                    console.info('[desktop-debug:getSubjectBounds]', { failed: true, subjectProbeLayerId, error: error?.message || '调用异常' });
                }
            } else {
                probeLines.push('未找到适合读取主体边界的可见图层，已跳过。');
                console.info('[desktop-debug:getSubjectBounds]', { skipped: true, reason: 'no visible normal layer' });
            }

            try {
                const detailTemplate = (await callPhotoshopMcpTool('parseDetailPageTemplate', { strict: false })) as PhotoshopMcpToolCallPayload;
                const failed = !!(detailTemplate?.error || detailTemplate?.isError === true || detailTemplate?.success === false);
                probeLines.push(`${failed ? '未通过' : '通过'} 详情页模板检查`);
                console.info('[desktop-debug:parseDetailPageTemplate]', { failed, error: (detailTemplate as any)?.error });
            } catch (error: any) {
                probeLines.push(`未通过 详情页模板检查`);
                console.info('[desktop-debug:parseDetailPageTemplate]', { failed: true, error: error?.message || '调用异常' });
            }

            console.info('[desktop-debug:summary]', {
                totalToolCount: tools.length,
                connectionSource: connectionStatus.source,
                missingTools
            });

            let report = `**设计联调检查（主图/详情页）**\n\n`;
            report += `- Photoshop 连接：已连接\n`;
            report += `- 关键处理项：${missingTools.length === 0 ? '完整' : `缺少 ${missingTools.length} 项`}\n\n`;
            report += `**任务判断**\n${routeLines.join('\n')}\n\n`;
            report += `**当前画面检查**\n${probeLines.join('\n')}\n\n`;
            report += `详细诊断已写入开发日志，聊天区只保留可读结论。`;

            addLocalAssistantMessage({
                content: report
            }, toolSummaryReplyOrigin('desktop-debug:report'));
        } catch (error: any) {
            addLocalAssistantMessage({
                content: formatUserVisibleFailureContent('桌面端联调失败', error)
            }, toolSummaryReplyOrigin('desktop-debug:failed'));
        } finally {
            setLoading(false);
        }
    };

    const handleCommand = (command: string) => {
        const cmd = command.toLowerCase().trim();
        const diagnosticsEnabled = isDiagnosticsCommandEnabled();

        if (cmd.startsWith('/desktop-debug')) {
            if (diagnosticsEnabled) {
                void handleDesktopDebug(command);
            } else {
                addLocalStatusMessage(
                    '这个内部检查命令只在开发验收模式下可用。',
                    'slash-command:diagnostics-disabled'
                );
            }
            return;
        }

        switch (cmd) {
            case '/optimize':
                handleOptimize();
                break;
            
            case '/help':
                addLocalAssistantMessage({
                    content: buildUserSlashHelpContent()
                }, uiStatusReplyOrigin('slash-command:help'));
                break;
            
            case '/test':
                if (diagnosticsEnabled) {
                    handleToolTest();
                } else {
                    addLocalStatusMessage(
                        '这个内部检查命令只在开发验收模式下可用。',
                        'slash-command:diagnostics-disabled'
                    );
                }
                break;

            case '/status':
                addLocalStatusMessage(`📊 **当前状态：**

- Photoshop 连接：${isPluginConnected ? '✅ 已连接' : '❌ 未连接'}
- Agent 版本：v1.0.0

${!isPluginConnected ? '\n⚠️ 请在 Photoshop 中加载 DesignEcho 插件以建立连接。' : ''}`,
                    'slash-command:status'
                );
                break;

            case '/clear':
                useAppStore.getState().clearMessages();
                addLocalStatusMessage('🧹 对话历史已清空。', 'slash-command:clear');
                break;

            case '/debug':
            case '/debug on':
                {
                    if (!diagnosticsEnabled) {
                        addLocalStatusMessage(
                            '这个内部检查命令只在开发验收模式下可用。',
                            'slash-command:diagnostics-disabled'
                        );
                        break;
                    }
                    const { toolLogger } = require('../services/tool-logger');
                    toolLogger.setDebugMode(true);
                    addLocalAssistantMessage({
                        content: `内部诊断已开启。

普通回复仍保持设计师表达；详细记录保存在本地诊断日志。

使用 \`/debug off\` 关闭内部诊断。`
                    }, uiStatusReplyOrigin('slash-command:debug-on'));
                }
                break;

            case '/debug off':
                {
                    if (!diagnosticsEnabled) {
                        addLocalStatusMessage(
                            '这个内部检查命令只在开发验收模式下可用。',
                            'slash-command:diagnostics-disabled'
                        );
                        break;
                    }
                    const { toolLogger } = require('../services/tool-logger');
                    toolLogger.setDebugMode(false);
                    addLocalStatusMessage('🔕 调试模式已关闭。', 'slash-command:debug-off');
                }
                break;

            case '/debug report':
                {
                    if (!diagnosticsEnabled) {
                        addLocalStatusMessage(
                            '这个内部检查命令只在开发验收模式下可用。',
                            'slash-command:diagnostics-disabled'
                        );
                        break;
                    }
                    const { toolLogger } = require('../services/tool-logger');
                    const report = toolLogger.generateDebugReport();
                    console.info('[debug-report]', report);
                    addLocalStatusMessage(
                        '内部诊断报告已写入开发日志，聊天区不展示底层记录。',
                        'slash-command:debug-report'
                    );
                }
                break;

            default:
                addLocalStatusMessage(
                    `❓ 未知命令：\`${command}\`\n\n输入 \`/help\` 查看可用命令。`,
                    'slash-command:unknown'
                );
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="chat-panel">
            {/* 消息列表 */}
            <div className="messages-container" data-testid="chat-messages">
                {messages.length === 0 ? (
                    <div className="welcome-message">
                        <div className="welcome-icon">🎨</div>
                        <h2>DesignEcho</h2>
                        <p>我是 DesignEcho，已加载当前项目的工作流，可以直接告诉我你的设计需求。</p>
                        
                        {/* [已移除] 快捷任务面板 - 使用自然语言交互代替 */}
                        
                    </div>
                ) : (
                    messages.map((msg) => {
                        if (editingMessageId === msg.id) {
                            return (
                                <div
                                    key={msg.id}
                                    className={`message-wrapper message ${msg.role}`}
                                    data-testid={`chat-message-${msg.role}`}
                                    data-message-id={msg.id}
                                    data-message-role={msg.role}
                                >
                                    <div className="message-avatar">👤</div>
                                    <div className="message-content">
                                        <div className="message-edit-container">
                                            <textarea
                                                className="message-edit-input"
                                                value={editingContent}
                                                onChange={(e) => setEditingContent(e.target.value)}
                                                rows={3}
                                                autoFocus
                                                spellCheck={false}
                                            />
                                            <div className="message-edit-actions">
                                                <button 
                                                    className="edit-cancel-btn"
                                                    onClick={handleCancelEdit}
                                                >
                                                    取消
                                                </button>
                                                <button 
                                                    className="edit-confirm-btn"
                                                    onClick={handleConfirmEdit}
                                                    disabled={!editingContent.trim()}
                                                >
                                                    保存并重新发送
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        const multimodalMsg = convertLegacyMessage(msg);
                        return (
                            <div
                                key={msg.id}
                                className="message-wrapper"
                                data-testid={`chat-message-${msg.role}`}
                                data-message-id={msg.id}
                                data-message-role={msg.role}
                            >
                                <MessageRenderer 
                                    message={multimodalMsg}
                                    isStreaming={msg.isThinking}
                                    onAction={handleMessageAction}
                                    showEditButton={msg.role === 'user' && !isLoading}
                                    onEdit={() => handleStartEdit(msg.id, msg.content)}
                                />
                                
                                {/* 保留旧版特殊组件：建议列表、布局修复列表 */}
                                {msg.suggestions && (
                                    <div className="message-extra-content">
                                        <SuggestionList 
                                            suggestions={msg.suggestions} 
                                            onApply={handleApplySuggestion}
                                        />
                                    </div>
                                )}
                                
                                {msg.layoutResult && (
                                    <div className="message-extra-content">
                                        <LayoutFixList
                                            result={msg.layoutResult}
                                            onApplyFix={handleApplyLayoutFix}
                                            onApplyAll={handleApplyAllLayoutFixes}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
                
                {/* 实时模型反馈 / 工具调用显示（加载过程中） */}
                {isLoading && activeAgentRunUiRef.current?.conversationId === currentConversationId && showThinking && (thinkingSteps.some(isVisiblePonderingStep) || liveActivity) && (
                    <div className="message assistant live-agent-message">
                        <div className="message-avatar">🤖</div>
                        <div className="message-content">
                            {thinkingSteps.some(isVisiblePonderingStep) ? (
                                <ThinkingProcess 
                                    steps={thinkingSteps}
                                    isExpanded={true}
                                    className="live-thinking"
                                />
                            ) : liveActivity ? (
                                <LiveActivityIndicator activity={liveActivity} />
                            ) : null}
                        </div>
                    </div>
                )}
                
                <div ref={messagesEndRef} />
            </div>

            {/* 输入区域 */}
            <div className="input-container">
                {showUpload && (
                    <div className="upload-panel">
                        <div className="upload-header">
                            <span>上传参考图</span>
                            <button className="close-upload" onClick={() => setShowUpload(false)}>×</button>
                        </div>
                        <ReferenceUpload onUpload={handleImageUpload} isLoading={isLoading} />
                    </div>
                )}
                
                {showReplicator && (
                    <div className="replicator-panel">
                        <ReferenceReplicator 
                            isPluginConnected={isPluginConnected} 
                            onClose={() => setShowReplicator(false)}
                        />
                    </div>
                )}
                
                <div className="input-wrapper">
                    {/* 附件按钮 - 点击展开菜单 */}
                    <div className="attach-menu-container">
                    <button 
                            className={`attach-button ${showAttachMenu || showImageGen ? 'active' : ''}`}
                            onClick={() => setShowAttachMenu(!showAttachMenu)}
                            title="添加附件"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                    </button>
                    
                        {/* 附件菜单 */}
                        {showAttachMenu && (
                            <div className="attach-menu" role="menu" aria-label="添加内容">
                                <button
                                    type="button"
                                    className="attach-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowAttachMenu(false);
                                        captureScreenshotForChat('agent');
                                    }}
                                >
                                    <span className="menu-icon menu-icon-agent" aria-hidden="true">AG</span>
                                    <span>截图 Agent 窗口</span>
                                </button>
                                <button
                                    type="button"
                                    className="attach-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowAttachMenu(false);
                                        captureScreenshotForChat('desktop');
                                    }}
                                >
                                    <span className="menu-icon menu-icon-screen" aria-hidden="true">PS</span>
                                    <span>截图桌面(含PS)</span>
                                </button>
                    <button 
                                    type="button"
                                    className="attach-menu-item"
                                    role="menuitem"
                                    onClick={() => {
                                        setShowAttachMenu(false);
                                        // 触发文件上传
                                        const fileInput = document.createElement('input');
                                        fileInput.type = 'file';
                                        fileInput.accept = 'image/*';
                                        fileInput.onchange = async (e) => {
                                            const file = (e.target as HTMLInputElement).files?.[0];
                                            if (file) {
                                                const reader = new FileReader();
                                                reader.onload = () => {
                                                    const base64 = (reader.result as string).split(',')[1];
                                                    setPastedImage({ data: base64, type: file.type });
                                                    setShowAttachMenu(false);
                                                };
                                                reader.readAsDataURL(file);
                                            }
                                        };
                                        fileInput.click();
                                    }}
                                >
                                    <span className="menu-icon menu-icon-image" aria-hidden="true">IMG</span>
                                    <span>上传图片</span>
                    </button>
                                <button 
                                    type="button"
                                    className={`attach-menu-item ${showImageGen ? 'selected' : ''}`}
                                    role="menuitem"
                                    onClick={() => {
                                        setShowImageGen(!showImageGen);
                                        setShowAttachMenu(false);
                                    }}
                                >
                                    <span className="menu-icon menu-icon-ai" aria-hidden="true">AI</span>
                                    <span>AI 生成图片</span>
                                    {showImageGen && <span className="check-icon">✓</span>}
                                </button>
                            </div>
                        )}
                    </div>
                    
                    <div 
                        ref={inputAreaRef}
                        className={`input-area ${isDraggingImage ? 'dragging' : ''} ${showImageGen ? 'gen-mode' : ''}`}
                        onDragEnter={handleDragEnter}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        {/* 拖拽指示器 */}
                        {isDraggingImage && (
                            <div className="drag-overlay">
                                <div className="drag-content">
                                    <span className="drag-icon">📷</span>
                                    <span className="drag-text">放开以添加图片</span>
                                </div>
                            </div>
                        )}
                        
                        {/* 图片预览 - 简化样式 */}
                        {(pastedImage || referenceImage) && (
                            <div className="image-preview-compact">
                                <img 
                                    src={pastedImage 
                                        ? `data:${pastedImage.type};base64,${pastedImage.data}` 
                                        : `data:image/jpeg;base64,${referenceImage}`
                                    } 
                                    alt="Preview" 
                                />
                                    <button 
                                    className="remove-image-btn"
                                    onClick={() => {
                                        setPastedImage(null);
                                        setReferenceImage(null);
                                    }}
                                        title="移除图片"
                                >×</button>
                            </div>
                        )}
                        
                        <textarea
                            ref={textareaRef}
                            className="chat-input"
                            data-testid="chat-input"
                            placeholder={showImageGen ? "描述你想要生成的图片…" : "输入需求…"}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            rows={1}
                            spellCheck={false}
                            autoComplete="off"
                            autoCorrect="off"
                        />

                        {(workflowSelectionContext?.selectedNode
                            || selectedAssetContext
                            || selectedEagleLibraryAsset
                            || knowledgeReferences.length > 0
                            || canShowThinkingModeToggle
                            || showImageGen
                            || canShowComposerModelSelect) && (
                            <div className="input-toolbar">
                                {workflowSelectionContext?.selectedNode && (
                                    <span
                                        className="composer-context-chip"
                                        data-testid="composer-workflow-selection"
                                        title={`已关联工作流节点：${workflowSelectionContext.selectedNode.data.title}`}
                                    >
                                        <span className="composer-context-chip-label">
                                            节点 · {workflowSelectionContext.selectedNode.data.title}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={onClearWorkflowSelection}
                                            aria-label="取消关联工作流节点"
                                        >×</button>
                                    </span>
                                )}

                                {selectedAssetContext && (
                                    <span
                                        className="composer-context-chip"
                                        data-testid="composer-asset-selection"
                                        title={`已关联项目素材：${selectedAssetContext.name}`}
                                    >
                                        <span className="composer-context-chip-label">
                                            素材 · {selectedAssetContext.name}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={onClearSelectedAssetContext}
                                            aria-label="取消关联项目素材"
                                        >×</button>
                                    </span>
                                )}

                                {selectedEagleLibraryAsset && (
                                    <span
                                        className="composer-context-chip"
                                        data-testid="composer-eagle-library-selection"
                                        title={`已关联 Eagle 素材：${selectedEagleLibraryAsset.name} · ${selectedEagleLibraryAsset.role}`}
                                    >
                                        <span className="composer-context-chip-label">
                                            Eagle · {selectedEagleLibraryAsset.name}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={onClearSelectedEagleLibraryAsset}
                                            aria-label="取消关联 Eagle 素材"
                                        >×</button>
                                    </span>
                                )}

                                {knowledgeReferences.map((reference) => {
                                    const useRoleLabel = KNOWLEDGE_REFERENCE_USE_ROLES[reference.useRole || 'general'].label;
                                    return (
                                        <span
                                            key={reference.bindingRef}
                                            className="composer-context-chip"
                                            data-testid="composer-knowledge-reference"
                                            title={`已关联知识：${reference.title} · ${reference.sourceRevision} · 用途：${useRoleLabel}`}
                                        >
                                            <span className="composer-context-chip-label">
                                                知识 · {useRoleLabel} · {reference.title}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => onRemoveKnowledgeReference?.(reference.bindingRef)}
                                                aria-label={`取消关联知识：${reference.title}`}
                                            >×</button>
                                        </span>
                                    );
                                })}

                                {canShowThinkingModeToggle && (
                                    <ThinkingModeControl
                                        enabled={composerThinkingPreference.enabled}
                                        onToggle={handleToggleComposerThinking}
                                        direction="up"
                                    />
                                )}

                                {showImageGen && (
                                    <div className="gen-mode-tag">
                                        <span>FLUX</span>
                                        <button type="button" onClick={() => setShowImageGen(false)}>×</button>
                                    </div>
                                )}

                                {canShowComposerModelSelect && (
                                    <select
                                        className="model-quick-select"
                                        data-testid="chat-primary-model-select"
                                        value={composerPrimaryModelId}
                                        onChange={handleSelectComposerPrimaryModel}
                                        title="主模型（与设置页「AI 模型 · 主模型」双向同步）"
                                        aria-label="主模型"
                                    >
                                        {/* 兜底：当前主模型不在可见列表（跨运行模式 / 动态拉取重置）时补一项，
                                            避免 select 静默回退到第一项，让用户误以为主模型被改。 */}
                                        {composerPrimaryModelId && !composerPrimaryModelListed && (
                                            <optgroup label="当前主模型">
                                                <option value={composerPrimaryModelId}>
                                                    {formatPrimaryModelShortName(getModelById(composerPrimaryModelId)?.name || composerPrimaryModelId)}
                                                </option>
                                            </optgroup>
                                        )}
                                        {composerModelGroups.map(group => (
                                            <optgroup key={group.label} label={group.label}>
                                                {group.options.map(option => (
                                                    <option key={option.id} value={option.id}>
                                                        {formatPrimaryModelShortName(option.name)}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>
                                )}
                            </div>
                        )}
                    </div>

                    {isLoading ? (
                        <button 
                            className="send-button stop-button"
                            onClick={() => {
                                console.log('[ChatPanel] 用户点击停止按钮');
                                stopGeneration();
                                // Abort 必须先发生，不能让会话写入异常阻断真正的停止。
                                markActiveAgentRunStopped();
                                // 立即收束当前轮次；旧异步结果返回后会被 runId 守卫拦截。
                            }}
                            title="停止生成"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="6" width="12" height="12" rx="2" />
                            </svg>
                        </button>
                    ) : (
                        <button 
                            className="send-button"
                            data-testid="chat-send"
                            onClick={() => handleSend()}
                            disabled={!input.trim() && !pastedImage}
                            title={pastedImage ? "发送图片和消息" : "发送消息"}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="19" x2="12" y2="5"></line>
                                <polyline points="6 11 12 5 18 11"></polyline>
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            <style>{`
                .chat-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                }

                .messages-container {
                    flex: 1;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding: 24px;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                }

                /* 多模态消息包装器 */
                .message-wrapper {
                    position: relative;
                    margin-bottom: 16px;
                    width: 100%;
                    inline-size: 100%;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    overflow-x: hidden;
                    box-sizing: border-box;
                }

                .message-wrapper:last-child {
                    margin-bottom: 0;
                }

                .message-extra-content {
                    margin-left: 48px;
                    margin-top: 8px;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: calc(100% - 48px);
                    max-inline-size: calc(100% - 48px);
                    overflow-x: hidden;
                    box-sizing: border-box;
                }

                
                /* 编辑模式下的消息容器 */
                .message-wrapper.message {
                    display: flex;
                    gap: 12px;
                    padding: 16px 24px;
                    width: 100%;
                    inline-size: 100%;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                    overflow-x: hidden;
                }
                
                .message-wrapper.message.user {
                    flex-direction: row-reverse;
                }
                
                .message-wrapper.message .message-content {
                    flex: 1;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: calc(100% - 60px);
                    max-inline-size: calc(100% - 60px);
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }
                
                .message-wrapper.message .message-avatar {
                    width: 36px;
                    height: 36px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    flex-shrink: 0;
                    background: var(--de-avatar-bg, rgba(255, 255, 255, 0.05));
                }

                /* 欢迎信息 */
                .welcome-message {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    text-align: center;
                    animation: fadeIn 0.5s ease-out;
                }

                .welcome-icon {
                    font-size: 64px;
                    margin-bottom: 16px;
                }

                .welcome-message h2 {
                    font-family: 'Space Grotesk', sans-serif;
                    font-size: 28px;
                    font-weight: 600;
                    margin-bottom: 8px;
                    background: linear-gradient(135deg, #fff 0%, #0066ff 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .welcome-message p {
                    color: var(--de-text-secondary);
                    margin-bottom: 32px;
                }

                .welcome-tips {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .tip-card {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 20px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 8px;
                    font-size: 14px;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .tip-card:hover {
                    background: var(--de-bg-light);
                    border-color: var(--de-primary);
                }

                .tip-icon {
                    font-size: 20px;
                }

                /* 消息 */
                .message {
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    margin-bottom: 20px;
                    animation: slideUp 0.3s ease-out;
                    width: 100%;
                    inline-size: 100%;
                    flex: 0 0 auto;
                    align-self: stretch;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                }

                .message.user {
                    flex-direction: row-reverse;
                }

                .message-avatar {
                    width: 36px;
                    height: 36px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-bg-light);
                    border-radius: 50%;
                    font-size: 18px;
                    flex-shrink: 0;
                }

                .message.user .message-avatar {
                    background: var(--de-primary);
                }

                .message-content {
                    flex: 1 1 0;
                    width: calc(100% - 48px);
                    inline-size: calc(100% - 48px);
                    max-width: min(70%, calc(100% - 48px));
                    max-inline-size: min(70%, calc(100% - 48px));
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                    min-inline-size: 0;
                    box-sizing: border-box;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }

                .message.live-agent-message .message-content {
                    flex: 1 0 calc(100% - 48px);
                    width: calc(100% - 48px);
                    inline-size: calc(100% - 48px);
                    min-width: min(320px, calc(100% - 48px));
                    min-inline-size: min(320px, calc(100% - 48px));
                    max-width: calc(100% - 48px);
                    max-inline-size: calc(100% - 48px);
                }

                .message.user .message-content {
                    flex: 0 1 min(70%, calc(100% - 48px));
                    width: auto;
                    inline-size: auto;
                    min-width: 0;
                    min-inline-size: 0;
                    max-width: min(70%, calc(100% - 48px));
                    max-inline-size: min(70%, calc(100% - 48px));
                    align-items: flex-end;
                }

                .message-text {
                    padding: 12px 16px;
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                    font-size: 14px;
                    line-height: 1.6;
                    white-space: pre-wrap;
                    max-width: 100%;
                    max-inline-size: 100%;
                    box-sizing: border-box;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }

                .message.user .message-text {
                    background: var(--de-user-bubble-bg, var(--de-primary));
                    border-color: var(--de-user-bubble-bg, var(--de-primary));
                    color: var(--de-user-bubble-text, white);
                }

                .message-text strong {
                    color: var(--de-primary);
                    font-weight: 600;
                }

                .message.user .message-text strong {
                    color: #fff;
                }

                .message-text code {
                    background: rgba(0, 102, 255, 0.2);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 13px;
                }

                .message-text p {
                    margin: 0 0 8px 0;
                }

                .message-text p:last-child {
                    margin-bottom: 0;
                }

                /* 执行结果卡片 */
                .result-card {
                    border-radius: 12px;
                    overflow: hidden;
                    background: var(--de-bg);
                    min-width: 0;
                    max-width: 100%;
                    box-sizing: border-box;
                }

                .result-card.success {
                    border: 1px solid rgba(16, 185, 129, 0.4);
                    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%);
                }

                .result-card.warning {
                    border: 1px solid rgba(245, 158, 11, 0.4);
                    background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(245, 158, 11, 0.02) 100%);
                }

                .result-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 14px 16px;
                    border-bottom: 1px solid var(--de-border);
                    min-width: 0;
                }

                .result-icon {
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    font-size: 14px;
                    font-weight: bold;
                }

                .result-card.success .result-icon {
                    background: rgba(16, 185, 129, 0.2);
                    color: #10b981;
                }

                .result-card.warning .result-icon {
                    background: rgba(245, 158, 11, 0.2);
                    color: #f59e0b;
                }

                .result-title {
                    font-size: 15px;
                    font-weight: 600;
                    color: var(--de-text);
                    min-width: 0;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }

                .result-details {
                    padding: 12px 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    min-width: 0;
                    max-width: 100%;
                    box-sizing: border-box;
                }

                .detail-row {
                    display: flex;
                    align-items: baseline;
                    gap: 8px;
                    font-size: 13px;
                    min-width: 0;
                    max-width: 100%;
                }

                .detail-label {
                    color: var(--de-text-secondary);
                    flex-shrink: 0;
                }

                .detail-value {
                    color: var(--de-text);
                    font-weight: 500;
                    min-width: 0;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }

                .result-list {
                    padding: 12px 16px;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                    background: rgba(0, 0, 0, 0.15);
                    min-width: 0;
                    max-width: 100%;
                    box-sizing: border-box;
                }

                .list-header {
                    font-size: 12px;
                    color: var(--de-text-secondary);
                    margin-bottom: 10px;
                    font-weight: 500;
                }

                .list-items {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    min-width: 0;
                    max-width: 100%;
                }

                .list-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 10px;
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 6px;
                    font-size: 12px;
                    min-width: 0;
                }

                .file-icon {
                    font-size: 14px;
                    opacity: 0.7;
                }

                .file-name {
                    color: var(--de-text);
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 11px;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .list-more {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                    padding: 6px 10px;
                    text-align: center;
                }

                .message-footer {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 8px;
                }

                .message-time {
                    font-size: 11px;
                    color: var(--de-text-secondary);
                }

                /* 消息编辑按钮 */
                .message-edit-btn {
                    opacity: 0;
                    background: none;
                    border: none;
                    cursor: pointer;
                    font-size: 12px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    transition: all 0.2s ease;
                }

                .message:hover .message-edit-btn {
                    opacity: 0.6;
                }

                .message-edit-btn:hover {
                    opacity: 1 !important;
                    background: rgba(99, 102, 241, 0.2);
                }

                /* 消息编辑容器 */
                .message-edit-container {
                    width: 100%;
                }

                .message-edit-input {
                    width: 100%;
                    min-height: 60px;
                    padding: 12px;
                    background: rgba(0, 0, 0, 0.3);
                    border: 1px solid var(--de-primary);
                    border-radius: 8px;
                    color: var(--de-text);
                    font-size: 14px;
                    font-family: inherit;
                    resize: vertical;
                    outline: none;
                }

                .message-edit-input:focus {
                    border-color: var(--de-primary);
                    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
                }

                .message-edit-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    margin-top: 8px;
                }

                .edit-cancel-btn {
                    padding: 6px 12px;
                    background: var(--de-hover-bg, rgba(0, 0, 0, 0.05));
                    border: 1px solid var(--de-border);
                    border-radius: 6px;
                    color: var(--de-text-secondary);
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .edit-cancel-btn:hover {
                    background: var(--de-bg-light);
                    color: var(--de-text);
                }

                .edit-confirm-btn {
                    padding: 6px 16px;
                    background: var(--de-primary);
                    border: none;
                    border-radius: 6px;
                    color: white;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .edit-confirm-btn:hover:not(:disabled) {
                    background: var(--de-primary-dark);
                    transform: translateY(-1px);
                }

                .edit-confirm-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                /* 上传面板 */
                .upload-panel {
                    background: var(--de-bg-card);
                    border: 1px solid var(--de-border);
                    border-radius: 12px;
                    padding: 12px;
                    margin-bottom: 12px;
                    animation: slideUp 0.2s ease-out;
                }

                .upload-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--de-text);
                }

                .close-upload {
                    background: none;
                    border: none;
                    color: var(--de-text-secondary);
                    font-size: 18px;
                    cursor: pointer;
                    padding: 4px;
                }

                .close-upload:hover {
                    color: var(--de-text);
                }

                /* 复刻面板 */
                .replicator-panel {
                    margin-bottom: 12px;
                    animation: slideUp 0.2s ease-out;
                }

                /* [已移除] 快速操作按钮样式 */

                .qa-icon {
                    font-size: 14px;
                }

                .qa-label {
                    font-weight: 500;
                }

                /* 输入区域 */
                .input-container {
                    padding: 16px 24px 24px;
                    background: linear-gradient(180deg, transparent 0%, var(--de-bg) 20%);
                }

                .input-wrapper {
                    display: flex;
                    gap: 8px;
                    background: var(--de-bg-card);
                    border: 1px solid rgba(72, 78, 102, 0.72);
                    border-radius: 22px;
                    padding: 7px 10px;
                    align-items: flex-end;
                    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
                }
                
                .input-area {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    min-width: 0;
                }
                
                .input-area.gen-mode {
                    /* 生成模式时的微妙提示 */
                }

                /* 附件按钮 - 简洁的 + 号 */
                .attach-menu-container {
                    position: relative;
                    align-self: center;  /* 垂直居中对齐 */
                }

                .attach-button {
                    background: transparent;
                    border: 1px solid transparent;
                    cursor: pointer;
                    padding: 6px;
                    border-radius: 50%;
                    transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    color: #2684ff;
                }

                .attach-button:hover {
                    background: rgba(38, 132, 255, 0.1);
                    border-color: rgba(38, 132, 255, 0.26);
                    color: #66aaff;
                }

                .attach-button.active {
                    color: #ffffff;
                    background: rgba(0, 102, 255, 0.18);
                    border-color: rgba(0, 102, 255, 0.36);
                    transform: rotate(45deg);
                }

                /* 附件菜单 */
                .attach-menu {
                    position: absolute;
                    bottom: calc(100% + 12px);
                    left: -8px;
                    width: 232px;
                    max-width: calc(100vw - 48px);
                    background: rgba(18, 18, 28, 0.98);
                    border: 1px solid rgba(76, 84, 110, 0.82);
                    border-radius: 12px;
                    padding: 8px;
                    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.02) inset;
                    z-index: 100;
                    backdrop-filter: blur(12px);
                }

                .attach-menu::after {
                    content: '';
                    position: absolute;
                    left: 20px;
                    bottom: -6px;
                    width: 10px;
                    height: 10px;
                    background: rgba(18, 18, 28, 0.98);
                    border-right: 1px solid rgba(76, 84, 110, 0.82);
                    border-bottom: 1px solid rgba(76, 84, 110, 0.82);
                    transform: rotate(45deg);
                }

                .attach-menu-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    width: 100%;
                    min-height: 42px;
                    padding: 8px 10px;
                    border: 1px solid transparent;
                    background: transparent;
                    color: var(--de-text);
                    font-size: 13px;
                    font-weight: 520;
                    line-height: 1.2;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
                    white-space: nowrap;
                    text-align: left;
                }

                .attach-menu-item:hover {
                    background: rgba(255, 255, 255, 0.065);
                    border-color: rgba(255, 255, 255, 0.08);
                    transform: translateX(1px);
                }

                .attach-menu-item.selected {
                    background: rgba(0, 102, 255, 0.16);
                    border-color: rgba(0, 102, 255, 0.26);
                    color: #8fbdff;
                }

                .attach-menu-item .menu-icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex: 0 0 28px;
                    width: 28px;
                    height: 28px;
                    border-radius: 8px;
                    background: rgba(255, 255, 255, 0.06);
                    color: #9db7df;
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 0;
                    font-variant-numeric: tabular-nums;
                }

                .attach-menu-item .menu-icon-image {
                    font-size: 9px;
                }

                .attach-menu-item:hover .menu-icon {
                    background: rgba(255, 255, 255, 0.09);
                    color: #d8e6ff;
                }

                .attach-menu-item.selected .menu-icon {
                    background: rgba(0, 102, 255, 0.24);
                    color: #ffffff;
                }

                .attach-menu-item .check-icon {
                    margin-left: auto;
                    color: #8fbdff;
                    font-size: 12px;
                }

                /* 简洁的图片预览 */
                .image-preview-compact {
                    position: relative;
                    display: inline-block;
                    width: 48px;
                    height: 48px;
                    border-radius: 8px;
                    overflow: hidden;
                    flex-shrink: 0;
                }

                .image-preview-compact img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .remove-image-btn {
                    position: absolute;
                    top: -4px;
                    right: -4px;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: var(--de-bg);
                    border: 1px solid var(--de-border);
                    color: var(--de-text-secondary);
                    font-size: 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 1;
                }

                .remove-image-btn:hover {
                    background: var(--de-danger);
                    color: white;
                    border-color: var(--de-danger);
                }

                .input-toolbar {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    flex-wrap: wrap;
                    min-height: 26px;
                }

                .composer-context-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    max-width: 100%;
                    min-width: 0;
                    min-height: 30px;
                    padding: 0 3px 0 10px;
                    border: 1px solid rgba(59, 130, 246, 0.34);
                    border-radius: 999px;
                    background: rgba(59, 130, 246, 0.12);
                    color: #9fc5ff;
                    font-size: 11px;
                }

                .composer-context-chip-label {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .composer-context-chip button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                    padding: 0;
                    border: 0;
                    border-radius: 50%;
                    background: transparent;
                    color: inherit;
                    cursor: pointer;
                    line-height: 1;
                }

                .composer-context-chip button:hover {
                    background: rgba(159, 197, 255, 0.16);
                    color: #ffffff;
                }

                /* 生成模式标签 */
                .gen-mode-tag {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 8px;
                    background: rgba(var(--de-primary-rgb), 0.1);
                    border-radius: 12px;
                    font-size: 11px;
                    color: var(--de-primary);
                    align-self: flex-start;
                }

                .gen-mode-tag button {
                    background: none;
                    border: none;
                    color: var(--de-primary);
                    cursor: pointer;
                    padding: 0;
                    font-size: 14px;
                    line-height: 1;
                    opacity: 0.7;
                }

                .gen-mode-tag button:hover {
                    opacity: 1;
                }

                .gen-spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid var(--de-border);
                    border-top-color: var(--de-primary);
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                /* 输入栏主模型快捷选择器：贴 Thinking 胶囊风格，靠工具条右侧。
                   去掉原生 select 箭头（appearance:none），用内嵌 SVG 细箭头，
                   分量与 26px 胶囊对齐；窄窗口按 min-width 优雅收缩不撑破工具条。 */
                .model-quick-select {
                    margin-left: auto;
                    /* 和右侧发送按钮之间留出呼吸间距，避免胶囊贴着按钮 */
                    margin-right: 12px;
                    flex: 0 1 auto;
                    min-width: 96px;
                    max-width: 190px;
                    height: 26px;
                    padding: 0 24px 0 12px;
                    border-radius: 999px;
                    border: 1px solid rgba(148, 163, 184, 0.22);
                    background-color: rgba(148, 163, 184, 0.08);
                    color: var(--de-text-secondary);
                    font-size: 12px;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    overflow: hidden;
                    cursor: pointer;
                    outline: none;
                    appearance: none;
                    -webkit-appearance: none;
                    background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
                    background-repeat: no-repeat;
                    background-position: right 9px center;
                    background-size: 10px 6px;
                    transition: background-color 0.16s ease, border-color 0.16s ease,
                        color 0.16s ease, box-shadow 0.16s ease;
                }

                .model-quick-select:hover {
                    background-color: rgba(148, 163, 184, 0.13);
                    border-color: rgba(148, 163, 184, 0.34);
                    color: var(--de-text);
                }

                .model-quick-select:focus {
                    border-color: rgba(38, 132, 255, 0.55);
                    box-shadow: 0 0 0 2px rgba(38, 132, 255, 0.16);
                    color: var(--de-text);
                }

                /* 原生下拉弹层随主题走：避免暗色主题下白底白字 */
                .model-quick-select option,
                .model-quick-select optgroup {
                    background: var(--de-bg-light);
                    color: var(--de-text);
                    font-size: 12px;
                }

                .mode-close {
                    background: none;
                    border: none;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    font-size: 16px;
                    padding: 2px 6px;
                    line-height: 1;
                    border-radius: 4px;
                    transition: all 0.15s;
                }

                .mode-close:hover {
                    background: rgba(var(--de-danger-rgb, 239, 68, 68), 0.1);
                    color: var(--de-danger, #ef4444);
                }

                .chat-input {
                    width: 100%;
                    background: transparent;
                    border: none;
                    color: var(--de-text);
                    font-size: 14px;
                    line-height: 1.5;
                    resize: none;
                    outline: none;
                    min-height: 24px;
                    max-height: 120px;
                    padding: 8px 0;
                }

                .chat-input::placeholder {
                    color: var(--de-text-secondary);
                }

                .send-button {
                    width: 40px;
                    height: 40px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--de-primary);
                    border: none;
                    border-radius: 8px;
                    color: white;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    flex-shrink: 0;
                }

                .send-button:hover:not(:disabled) {
                    background: #0055dd;
                    transform: scale(1.05);
                }

                .send-button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .send-button.stop-button {
                    background: #ef4444;
                    animation: pulse-stop 1.5s ease-in-out infinite;
                }

                .send-button.stop-button:hover {
                    background: #dc2626;
                    transform: scale(1.05);
                }

                @keyframes pulse-stop {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
                    50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
                }
                
                /* 参考图预览 */
                .reference-preview {
                    display: flex;
                    gap: 12px;
                    background: var(--de-bg-light);
                    padding: 8px;
                    border-radius: 8px;
                    margin-bottom: 8px;
                }
                
                .reference-preview img {
                    width: 60px;
                    height: 60px;
                    object-fit: cover;
                    border-radius: 4px;
                    border: 1px solid var(--de-border);
                }
                
                .reference-info {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 12px;
                    color: var(--de-text-secondary);
                }
                
                .analyze-btn {
                    padding: 4px 12px;
                    background: var(--de-primary);
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                }
                
                .analyze-btn:disabled {
                    opacity: 0.5;
                    cursor: wait;
                }

                /* 粘贴图片预览 */
                .pasted-image-preview {
                    display: flex;
                    gap: 12px;
                    background: linear-gradient(135deg, var(--de-bg-light), rgba(var(--de-primary-rgb), 0.1));
                    padding: 10px;
                    border-radius: 10px;
                    margin-bottom: 8px;
                    border: 1px solid rgba(var(--de-primary-rgb), 0.2);
                    animation: fadeIn 0.2s ease-out;
                }

                .pasted-image-preview img {
                    width: 80px;
                    height: 80px;
                    object-fit: cover;
                    border-radius: 6px;
                    border: 2px solid var(--de-primary);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }

                .pasted-image-info {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-size: 13px;
                    color: var(--de-text-primary);
                    font-weight: 500;
                }

                .remove-pasted-btn {
                    width: 24px;
                    height: 24px;
                    border-radius: 50%;
                    background: var(--de-bg);
                    border: 1px solid var(--de-border);
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    font-size: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.15s ease;
                }

                .remove-pasted-btn:hover {
                    background: var(--de-danger);
                    border-color: var(--de-danger);
                    color: white;
                }

                /* 拖拽状态 */
                .input-area {
                    position: relative;
                    transition: all 0.2s ease;
                }

                .input-area.dragging {
                    border-color: var(--de-primary);
                    background: rgba(var(--de-primary-rgb), 0.05);
                }

                .drag-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(var(--de-primary-rgb), 0.1);
                    backdrop-filter: blur(2px);
                    border: 2px dashed var(--de-primary);
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10;
                    animation: dragPulse 1s ease infinite;
                }

                @keyframes dragPulse {
                    0%, 100% { 
                        border-color: var(--de-primary);
                        background: rgba(var(--de-primary-rgb), 0.1);
                    }
                    50% { 
                        border-color: rgba(var(--de-primary-rgb), 0.6);
                        background: rgba(var(--de-primary-rgb), 0.15);
                    }
                }

                .drag-content {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 8px;
                    color: var(--de-primary);
                    font-weight: 500;
                }

                .drag-icon {
                    font-size: 32px;
                    animation: bounce 0.5s ease infinite alternate;
                }

                @keyframes bounce {
                    from { transform: translateY(0); }
                    to { transform: translateY(-5px); }
                }

                .drag-text {
                    font-size: 14px;
                    opacity: 0.9;
                }

                /* 消息中的图片显示 */
                .message-image {
                    margin-bottom: 12px;
                    border-radius: 8px;
                    overflow: hidden;
                    max-width: 300px;
                    border: 1px solid var(--de-border);
                }

                .message-image img {
                    width: 100%;
                    height: auto;
                    display: block;
                }

                .message.user .message-image {
                    margin-left: auto;
                }
                
                .remove-btn {
                    margin-left: auto;
                    background: none;
                    border: none;
                    font-size: 16px;
                    color: var(--de-text-secondary);
                    cursor: pointer;
                    padding: 4px;
                }
                
                .remove-btn:hover {
                    color: var(--de-text);
                }
            `}</style>
        </div>
    );
};
