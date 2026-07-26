/**
 * 消息解析器
 * 
 * 将传统消息格式转换为多模态内容块格式
 * 
 * 性能优化：
 * - 稳定 ID 生成（基于内容哈希）
 * - 转换结果缓存
 * - 避免不必要的字符串操作
 */

import type { ActionItem, ContentBlock, MultimodalMessage, TextBlock, CodeBlock, ImageBlock, ToolResultBlock, CardBlock, CollapsibleBlock, ThinkingBlock as ThinkingBlockType, TaskPlanBlock as TaskPlanBlockType, InteractiveCardBlock, ParseOptions } from './types';
import type {
    InteractiveCardDefinition,
    InteractiveCardSubmission
} from '../../../shared/interactive-card-contract';
import { getToolDisplayInfo } from '../../services/tool-display-info';
import type { AgentExecutionSummary } from '../../services/agent-runtime/types';
import type { BusinessSkillVisualObservationFeedback } from '../../../shared/business-skill-visual-observation-feedback';
import type { AgentTaskPlanningContract } from '../../../shared/agent-task-planning-contract';
import type { AgentTaskPlanPresentation } from '../../../shared/agent-task-plan-presentation';
import type { AgentUserVisibleState } from '../../../shared/agent-user-visible-state';
import type { AgentTaskPublicPlanExecutionRequest } from '../../../shared/agent-task-public-plan-execution-request';
import type { AgentTaskPublicPlanApprovalRecord } from '../../../shared/agent-task-public-plan-approval-record';
import type { AgentTaskPublicPlanControlledRun } from '../../../shared/agent-task-public-plan-controlled-runner';
import type { SkuDeliverySummary, SkuDeliveryStatus } from '../../../shared/sku-delivery-summary';
import {
    normalizeAgentExecutionSummaryText,
    resolveAgentExecutionBusinessActivityCounts
} from '../../../shared/agent-execution-activity-counts';
import { normalizeAgentResponsePresentation } from '../../../shared/agent-response-presentation';
import {
    isAgentResponseInterruptionSentinelContent,
    resolveAgentResponseInterruption,
    type AgentResponseInterruption
} from '../../../shared/agent-response-interruption';
import {
    isDeterministicVisibleNoticeOrigin,
    normalizeAssistantReplyOriginForDisplay,
    type AssistantReplyOrigin
} from '../../../shared/assistant-reply-origin';
import {
    sanitizeUserVisibleAssistantBodyText,
    sanitizeUserVisibleDiagnosticText,
    sanitizeUserVisibleThinkingText
} from '../../../shared/chat-response-cleaner';
import {
    resolveThinkingStepDisplayRole,
    resolveThinkingStepRoleLabel
} from './thinkingStepPresentation';

// ==================== 类型定义 ====================

// 旧版思维步骤类型
interface LegacyThinkingStep {
    id: string;
    type: 'thinking' | 'status' | 'tool_call' | 'tool_result' | 'decision' | 'reading' | 'exploring' | 'analyzing';
    content: string;
    toolName?: string;
    toolParams?: any;
    toolResult?: any;
    imageData?: string;
    status: 'pending' | 'running' | 'success' | 'error';
    timestamp: number;
    duration?: number;
    filePath?: string;
    lineRange?: string;
}

// 旧版消息类型
interface LegacyMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    suggestions?: any[];
    layoutResult?: any;
    copyResult?: any;
    isThinking?: boolean;
    thinkingSteps?: LegacyThinkingStep[];
    executionSummary?: AgentExecutionSummary;
    businessVisualObservationFeedback?: BusinessSkillVisualObservationFeedback;
    agentTaskPlan?: AgentTaskPlanningContract;
    agentTaskPlanPresentation?: AgentTaskPlanPresentation;
    agentTaskPublicPlanExecutionRequest?: AgentTaskPublicPlanExecutionRequest;
    agentTaskPublicPlanApprovalRecord?: AgentTaskPublicPlanApprovalRecord;
    agentTaskPublicPlanControlledRun?: AgentTaskPublicPlanControlledRun;
    skuDeliverySummary?: SkuDeliverySummary;
    interactiveCards?: InteractiveCardDefinition[];
    interactiveCardSubmissions?: InteractiveCardSubmission[];
    assistantReplyOrigin?: AssistantReplyOrigin;
    agentResponseInterruption?: AgentResponseInterruption;
    conversationalModelFailure?: any;
    image?: { data: string; type: string };
}
// ==================== 缓存机制 ====================

/**
 * 消息转换缓存
 * 
 * 使用 WeakMap 存储转换结果：
 * - 键：原始消息对象引用
 * - 值：缓存条目（包含转换结果和验证用的内容哈希）
 * 
 * WeakMap 优势：当原始消息被 GC 时，缓存自动清理
 */
interface CacheEntry {
    result: MultimodalMessage;
    contentHash: string;
    thinkingStepsLength: number;
    thinkingStepsHash: string;
    isThinking: boolean;
    hasImage: boolean;
    executionSummaryHash: string;
    businessVisualObservationFeedbackHash: string;
    agentTaskPlanUserVisibleStateHash: string;
    agentTaskPlanPresentationHash: string;
    publicPlanExecutionRequestHash: string;
    publicPlanApprovalRecordHash: string;
    publicPlanControlledRunHash: string;
    skuDeliverySummaryHash: string;
    interactiveCardsHash: string;
    interactiveCardSubmissionsHash: string;
    assistantReplyOriginHash: string;
    agentResponseInterruptionHash: string;
}

const conversionCache = new WeakMap<LegacyMessage, CacheEntry>();

function safeDiagnosticText(value: unknown): string {
    return sanitizeUserVisibleDiagnosticText(String(value ?? ''))
        .replace(/工具调用/g, '画面处理')
        .replace(/业务\s*skill/gi, '设计任务')
        .replace(/ContextSnapshot\s*\/\s*ProjectAssetIndex/gi, '项目上下文或素材索引')
        .replace(/VisualInsightCache/gi, '已有素材理解结果')
        .replace(/视觉洞察缓存/g, '素材理解结果');
}

function safeThinkingText(value: unknown): string {
    return sanitizeUserVisibleThinkingText(String(value ?? ''))
        .replace(/ContextSnapshot\s*\/\s*ProjectAssetIndex/gi, '项目上下文或素材索引')
        .replace(/VisualInsightCache/gi, '已有素材理解结果')
        .replace(/视觉洞察缓存/g, '素材理解结果');
}

function safeCardText(value: unknown, fallback: string): string {
    return safeDiagnosticText(value) || fallback;
}

function normalizeCardLineForComparison(value: string): string {
    return String(value || '')
        .replace(/^[-•]\s*/u, '')
        .replace(/[。；;，,\s]+$/u, '')
        .replace(/\s+/g, '');
}

function collectDistinctCardLines(primary: string, candidates: string[]): string[] {
    const seen = new Set<string>();
    const primaryKey = normalizeCardLineForComparison(primary);
    if (primaryKey) seen.add(primaryKey);

    return candidates.filter((candidate) => {
        const key = normalizeCardLineForComparison(candidate);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function safePublicPlanDesignText(value: unknown): string {
    return safeDiagnosticText(value)
        .replace(/\blayer_hierarchy\b/ig, '图层情况')
        .replace(/\bacceptance_snapshot\b/ig, '画面快照')
        .replace(/\bdocument_info\b/ig, '文档信息')
        .replace(/读回图层结构/g, '检查图层是否真实创建')
        .replace(/读回图层/g, '检查图层')
        .replace(/读回验收快照/g, '查看画面结果')
        .replace(/读回画面/g, '查看画面')
        .replace(/读回导出文件/g, '检查导出文件')
        .replace(/执行后读回/g, '完成后复核')
        .replace(/读回/g, '复核')
        .replace(/工具执行/g, '处理')
        .replace(/受控/g, '确认范围内')
        .replace(/^公开设计计划[：:]\s*/u, '')
        .replace(/；?等待用户确认后才允许(?:受控)?执行。?$/u, '')
        .replace(/；?确认后(?:才)?(?:允许|开始)(?:受控)?执行。?$/u, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function safePublicPlanRequestStatus(status: unknown): string {
    const value = String(status || '').trim();
    if (value === 'ready_for_controlled_execution_request') return '准备开始';
    if (value === 'blocked_pending_user_confirmation') return '等待确认';
    if (value.startsWith('blocked_')) return '当前条件不完整';
    return safeDiagnosticText(value) || '状态未知';
}

function safePublicPlanControlledRunStatus(status: unknown): string {
    const value = String(status || '').trim();
    if (value === 'completed_dry_run') return '计划已检查';
    if (value === 'completed_fake_adapter_verified') return '计划已检查';
    if (value === 'completed_live_adapter_verified') return '画面已创建，待复核';
    if (value === 'failed_write_operation') return '处理未完成';
    if (value === 'failed_readback') return '复核未完成';
    if (value.startsWith('blocked_')) return '当前条件不完整';
    return safeDiagnosticText(value) || '状态未知';
}

function getAgentUserVisibleStateVariant(
    category: AgentUserVisibleState['category']
): CardBlock['variant'] {
    if (category === 'blocked') return 'warning';
    if (category === 'clarification') return 'warning';
    if (category === 'controlled_execution') return 'info';
    if (category === 'planning') return 'info';
    if (category === 'read_only') return 'neutral';
    return 'neutral';
}

function resolveAgentUserVisibleState(
    plan: AgentTaskPlanningContract | undefined
): AgentUserVisibleState | undefined {
    const state = (plan as any)?.userVisibleState;
    if (!state || state.version !== 'agent-user-visible-state/v0') return undefined;
    if (!state.title || !state.summary || !state.nextStep || !state.toolUse) return undefined;
    return state as AgentUserVisibleState;
}

function getSkuDeliverySummaryVariant(status: SkuDeliveryStatus): CardBlock['variant'] {
    if (status === 'completed') return 'success';
    if (status === 'partial') return 'warning';
    return 'error';
}

function formatSkuNoteSummary(noteCount: number, skippedNoteCount: number): string {
    const parts: string[] = [];
    if (noteCount > 0) parts.push(`${noteCount}个`);
    if (skippedNoteCount > 0) parts.push(`跳过${skippedNoteCount}个`);
    return parts.join('，') || '0个';
}

function buildSkuDeliverySummaryBlocks(
    summary: SkuDeliverySummary | undefined,
    messageId: string,
    startIndex: number
): ContentBlock[] {
    if (!summary || summary.version !== 'sku-delivery-summary/v0') return [];
    const compactText = safeCardText(summary.compactText, 'SKU 任务已完成，明细可展开查看。');
    const statusCard: CardBlock = {
        id: createStableId(messageId, 'sku-delivery-summary', startIndex),
        type: 'card',
        variant: getSkuDeliverySummaryVariant(summary.status),
        title: 'SKU 交付状态',
        content: compactText,
        details: [
            { label: '素材', value: safeCardText(summary.skuDocName, '未识别') },
            { label: '规格', value: summary.processedSizes.length > 0 ? summary.processedSizes.join('、') : '未生成' },
            { label: '组合', value: `${Math.max(0, summary.totalCombos)}组` },
            { label: '自选备注', value: formatSkuNoteSummary(summary.noteCount, summary.skippedNoteCount) },
            { label: '导出', value: `${Math.max(0, summary.exportCount)}张` },
            { label: '复核', value: `${Math.max(0, summary.warningCount)}条` }
        ]
    };
    const detailBlock: CollapsibleBlock = {
        id: createStableId(messageId, 'sku-delivery-details', startIndex + 1),
        type: 'collapsible',
        title: 'SKU 明细',
        icon: 'i',
        defaultExpanded: false,
        content: [{
            id: createStableId(messageId, 'sku-delivery-details-text', startIndex + 2),
            type: 'text',
            format: 'plain',
            content: safeCardText(summary.detailText, '暂无明细。')
        } as TextBlock]
    };
    return [statusCard, detailBlock];
}

function shouldSkipPlainContentForSkuDelivery(
    content: string,
    summary: SkuDeliverySummary | undefined
): boolean {
    if (!summary) return false;
    const normalizedContent = sanitizeUserVisibleAssistantBodyText(content).trim();
    const normalizedCompact = sanitizeUserVisibleAssistantBodyText(summary.compactText).trim();
    return normalizedContent.length > 0 && normalizedContent === normalizedCompact;
}

function isOriginNoticeAssistantContent(message: LegacyMessage): boolean {
    const assistantReplyOrigin = normalizeAssistantReplyOriginForDisplay(message.assistantReplyOrigin);
    return message.role === 'assistant'
        && isDeterministicVisibleNoticeOrigin(assistantReplyOrigin);
}

function buildOriginNoticeContentBlock(
    content: string,
    message: LegacyMessage,
    index: number
): TextBlock | null {
    if (!isOriginNoticeAssistantContent(message)) return null;
    const safeContent = sanitizeUserVisibleAssistantBodyText(content).trim();
    if (!safeContent) return null;
    return {
        id: createStableId(message.id, 'origin-notice-content', index),
        type: 'text',
        // 用 markdown 渲染：工具结果摘要（如设计参考检索）常含标题/列表/来源链接，
        // plain 会把结构压成一段文字流。TextBlock 的 parseMarkdown 先转义 HTML 再解析，XSS 安全。
        format: 'markdown',
        content: safeContent
    };
}

function shouldRenderPersistentThinkingSteps(message: LegacyMessage): boolean {
    const steps = Array.isArray(message.thinkingSteps) ? message.thinkingSteps : [];
    if (steps.length === 0) return false;

    const requestKind = String((message.agentTaskPlan as any)?.requestKind || '');
    const route = String((message.agentTaskPlan as any)?.route || '');
    const hasToolTrace = steps.some(step => step.type === 'tool_call' || step.type === 'tool_result');
    if (hasToolTrace) return true;

    return requestKind !== 'chat_only' && route !== 'direct_response';
}

/**
 * 简单字符串哈希（djb2 算法）
 * 用于检测内容变化，非加密用途
 */
function hashString(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return hash.toString(36);
}

function safeCacheStringify(value: unknown): string {
    if (value === undefined) return '';
    try {
        return JSON.stringify(value) || '';
    } catch {
        return String(value);
    }
}

function hashCachePayload(value: unknown): string {
    const text = safeCacheStringify(value);
    return text ? hashString(text) : '';
}

function buildThinkingStepsHash(steps?: LegacyThinkingStep[]): string {
    if (!Array.isArray(steps) || steps.length === 0) return '';

    const signature = steps.map((step) => ({
        id: step.id,
        type: step.type,
        status: step.status,
        content: step.content,
        toolName: step.toolName,
        toolParamsHash: hashCachePayload(step.toolParams),
        toolResultHash: hashCachePayload(step.toolResult),
        duration: step.duration,
        filePath: step.filePath,
        lineRange: step.lineRange
    }));

    return hashString(safeCacheStringify(signature));
}

function normalizeHistoricalThinkingSteps(
    steps: LegacyThinkingStep[],
    isStreaming = false
): LegacyThinkingStep[] {
    if (!Array.isArray(steps) || steps.length === 0) return [];
    if (isStreaming) return steps;

    return steps.map((step) => {
        if (step.status !== 'running' && step.status !== 'pending') return step;
        return {
            ...step,
            status: 'success'
        };
    });
}

/**
 * 生成稳定 ID
 * 
 * 基于消息 ID、类型和索引生成确定性 ID
 * 相同输入总是产生相同输出，避免 React key 变化
 */
function createStableId(messageId: string, blockType: string, index: number): string {
    return `${messageId}-${blockType}-${index}`;
}

function buildAgentTaskPlanPresentationBlock(
    presentation: AgentTaskPlanPresentation | undefined,
    messageId: string,
    index: number
): TaskPlanBlockType | null {
    if (!presentation || presentation.version !== 'agent-task-plan-presentation/v0') return null;
    if (!Array.isArray(presentation.steps) || presentation.steps.length === 0) return null;
    return {
        id: createStableId(messageId, 'task-plan', index),
        type: 'task_plan',
        presentation
    };
}

function withActionPayload(
    params: Record<string, any>,
    payload: Record<string, any> = params
): Record<string, any> {
    return {
        ...params,
        payload
    };
}

function buildExecutionSummaryCard(
    summary: AgentExecutionSummary | undefined,
    messageId: string,
    index: number
): CardBlock | null {
    if (!summary) return null;
    // 卡片「原因」也用设计师/口语，不出现 harness 话术（本轮/上限/检查/循环）。
    const stopReasonLabels: Record<string, string> = {
        final_response: '已给出说明',
        tool_budget_final_response: '先做到这里',
        max_iterations: '先做到这里',
        performance_budget: '先做到这里',
        no_progress: '中途卡住了',
        empty_final_response: '没有给出说明',
        tool_preflight_blocked: '还没能开始',
        awaiting_user_confirmation: '等你确认',
        cancelled: '你已停止',
        error: '出了点问题'
    };

    const statusConfig: Record<AgentExecutionSummary['status'], {
        label: string;
        variant: CardBlock['variant'];
        icon: string;
        defaultCollapsed: boolean;
    }> = {
        completed: {
            label: '已完成',
            variant: 'success',
            icon: '✓',
            defaultCollapsed: true
        },
        needs_review: {
            label: '需复核',
            variant: 'warning',
            icon: '!',
            defaultCollapsed: true
        },
        failed: {
            label: '未完成',
            variant: 'error',
            icon: '!',
            defaultCollapsed: false
        },
        cancelled: {
            label: '已取消',
            variant: 'neutral',
            icon: 'i',
            defaultCollapsed: false
        },
        // 等待用户确认是正常暂停：中性样式、默认折叠，不用红色报错，避免看起来像失败。
        awaiting_confirmation: {
            label: '等待确认',
            variant: 'neutral',
            icon: 'i',
            defaultCollapsed: true
        }
    };

    const config = statusConfig[summary.status] || statusConfig.needs_review;
    const activityCounts = resolveAgentExecutionBusinessActivityCounts(summary);
    const details: CardBlock['details'] = [
        { label: '状态', value: config.label },
        { label: '原因', value: stopReasonLabels[String(summary.stopReason || '')] || safeDiagnosticText(summary.stopReason) }
    ];

    if (activityCounts.total > 0) {
        details.push({
            label: '完成情况',
            value: activityCounts.breakdownAvailable
                ? `${activityCounts.completed} 项完成 / ${activityCounts.failed} 项未完成`
                : `共 ${activityCounts.total} 项 / 旧记录未保存完成明细`
        });
    }
    const checkTotal = (summary.acceptanceVerified || 0) + (summary.acceptanceFailed || 0) + (summary.acceptanceNeedsReview || 0);
    if (checkTotal > 0) {
        details.push({
            label: '结果检查',
            value: `${summary.acceptanceVerified || 0} 通过 / ${summary.acceptanceFailed || 0} 未通过 / ${summary.acceptanceNeedsReview || 0} 待复核`
        });
    }
    if (summary.noDocumentChangeRisks > 0) {
        details.push({ label: '无变化风险', value: summary.noDocumentChangeRisks });
    }
    if (summary.lastError) {
        details.push({ label: '问题', value: safeDiagnosticText(summary.lastError) });
    }

    const summaryText = normalizeAgentExecutionSummaryText(
        safeCardText(summary.summaryText, `处理状态：${config.label}`),
        activityCounts
    );
    const blockers = Array.isArray(summary.blockers) ? summary.blockers.slice(0, 2).map(safeDiagnosticText) : [];
    const warnings = Array.isArray(summary.warnings) ? summary.warnings.slice(0, 2).map(safeDiagnosticText) : [];
    const extraLines = collectDistinctCardLines(summaryText, [...blockers, ...warnings]);
    const content = [
        summaryText,
        ...extraLines.map((item) => `- ${item}`)
    ].join('\n');

    return {
        id: createStableId(messageId, 'execution-summary', index),
        type: 'card',
        variant: config.variant,
        icon: config.icon,
        title: `处理结果：${config.label}`,
        content,
        details,
        collapsible: true,
        defaultCollapsed: config.defaultCollapsed
    };
}

function buildAgentUserVisibleStateCard(
    plan: AgentTaskPlanningContract | undefined,
    messageId: string,
    index: number
): CardBlock | null {
    const state = resolveAgentUserVisibleState(plan);
    if (!state) return null;
    if (state.category === 'conversation' && !state.userActionRequired) return null;
    if (state.category === 'clarification') return null;

    const safeTitle = safeCardText(state.title, '本轮状态');
    const summary = safeDiagnosticText(state.summary);
    const nextStep = safeDiagnosticText(state.nextStep);
    const content = [
        summary,
        nextStep ? `下一步：${nextStep}` : ''
    ].filter(Boolean).join('\n');

    return {
        id: createStableId(messageId, 'agent-state', index),
        type: 'card',
        variant: getAgentUserVisibleStateVariant(state.category),
        icon: state.userActionRequired ? '!' : 'i',
        title: safeTitle,
        content,
        collapsible: true,
        defaultCollapsed: state.category === 'conversation'
    };
}

function shouldSuppressAgentUserVisibleStateCard(message: LegacyMessage): boolean {
    const state = resolveAgentUserVisibleState(message.agentTaskPlan);
    if (!state) return false;
    if (!state.userActionRequired) return true;
    const assistantReplyOrigin = normalizeAssistantReplyOriginForDisplay(message.assistantReplyOrigin);
    return message.role === 'assistant'
        && assistantReplyOrigin.userVisibleKind === 'tool_summary'
        && state.category === 'read_only'
        && !state.userActionRequired;
}

function buildBusinessVisualObservationFeedbackCard(
    feedback: BusinessSkillVisualObservationFeedback | undefined,
    messageId: string,
    index: number
): CardBlock | null {
    if (!shouldRenderBusinessVisualObservationFeedbackCard(feedback)) return null;

    const variantBySeverity: Record<BusinessSkillVisualObservationFeedback['severity'], CardBlock['variant']> = {
        none: 'neutral',
        info: 'info',
        warning: 'warning'
    };

    const iconBySeverity: Record<BusinessSkillVisualObservationFeedback['severity'], string> = {
        none: 'i',
        info: 'i',
        warning: '!'
    };

    const safeTitle = safeCardText(feedback.title, '处理前先确认');
    const warningLines = feedback.warningItems.slice(0, 2).map(safeDiagnosticText).filter(Boolean).map((item) => `- ${item}`);
    const content = [
        safeDiagnosticText(feedback.summary),
        safeDiagnosticText(feedback.actionHint),
        ...warningLines
    ].filter(Boolean).join('\n');

    return {
        id: createStableId(messageId, 'business-visual-observation-feedback', index),
        type: 'card',
        variant: variantBySeverity[feedback.severity] || 'warning',
        icon: iconBySeverity[feedback.severity] || '!',
        title: `素材提示：${safeTitle}`,
        content,
        collapsible: true,
        defaultCollapsed: feedback.severity === 'info'
    };
}

function shouldRenderBusinessVisualObservationFeedbackCard(
    feedback: BusinessSkillVisualObservationFeedback | undefined
): feedback is BusinessSkillVisualObservationFeedback {
    if (!feedback || feedback.userVisible !== true) return false;
    if (!Array.isArray(feedback.missingInputs) || feedback.missingInputs.length === 0) return false;
    return feedback.recommendedActions.includes('refresh_project_context')
        || feedback.recommendedActions.includes('ask_user_to_select_images');
}

function collectBusinessFeedbackVisibleText(feedback?: BusinessSkillVisualObservationFeedback): string {
    if (!feedback) return '';
    return [
        feedback.title,
        feedback.summary,
        feedback.actionHint,
        ...(Array.isArray(feedback.missingInputs) ? feedback.missingInputs : []),
        ...(Array.isArray(feedback.warningItems) ? feedback.warningItems : [])
    ].map((item) => safeDiagnosticText(item)).filter(Boolean).join(' ');
}

function hasExecutionCompletionActivity(summary: AgentExecutionSummary): boolean {
    const activityCounts = resolveAgentExecutionBusinessActivityCounts(summary);
    return activityCounts.total > 0
        || summary.acceptanceVerified > 0
        || summary.acceptanceFailed > 0
        || summary.acceptanceNeedsReview > 0
        || summary.noDocumentChangeRisks > 0
        || !!summary.taskCompletion;
}

function isAssistantReplyRequestingUserInput(content: string): boolean {
    const normalized = sanitizeUserVisibleAssistantBodyText(content)
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return false;

    return /(请告诉我[:：]?|告诉我[:：]?|请提供|请补充|需要你提供|需要你补充|需要先确认|先确认|补充.*后再继续|有了这些信息)/u.test(normalized)
        || /(产品类型|需求|素材来源|图片|模板|项目素材|风格|尺寸|目标).{0,80}(告诉我|提供|补充|确认)/u.test(normalized)
        || /(如果你需要我开始|如果要开始|开始做.*请告诉我|我就可以立即开工)/u.test(normalized);
}

function shouldSuppressCompletedExecutionSummaryCard(message: LegacyMessage): boolean {
    if (message.role !== 'assistant') return false;
    const summary = message.executionSummary;
    if (!summary || summary.status !== 'completed') return false;

    const state = resolveAgentUserVisibleState(message.agentTaskPlan);
    if (state?.category === 'clarification' || state?.userActionRequired) return true;

    const content = sanitizeUserVisibleAssistantBodyText(message.content || '').trim();
    if (!content) return false;
    if (isAssistantReplyRequestingUserInput(content)) return true;

    // final_response means the model loop ended. Without tool or acceptance activity,
    // it is a conversational reply rather than a completed processing result.
    return String(summary.stopReason || '') === 'final_response'
        && !hasExecutionCompletionActivity(summary);
}

function isConversationalUnavailableNotice(message: LegacyMessage): boolean {
    if (message.role !== 'assistant') return false;
    const assistantReplyOrigin = normalizeAssistantReplyOriginForDisplay(message.assistantReplyOrigin);
    const combined = [
        message.content,
        message.executionSummary?.summaryText,
        message.executionSummary?.lastError,
        ...(Array.isArray(message.executionSummary?.blockers) ? message.executionSummary.blockers : [])
    ].map((item) => String(item || '')).join(' ');

    return Boolean((message as any).conversationalModelFailure)
        || assistantReplyOrigin.source === 'conversational:unavailable'
        || /\bConversational reply unavailable\b/i.test(combined)
        || /(这次没有拿到模型回复|暂时没有拿到(?:可靠|稳定)回复|对话模型没有返回有效内容|当前没有生成可展示回复|没有收到模型回复|没有拿到模型回复)/u.test(combined);
}

function shouldUseCompactAssistantFailureView(message: LegacyMessage): boolean {
    if (message.role !== 'assistant') return false;

    const content = sanitizeUserVisibleAssistantBodyText(message.content || '').trim();
    if (!content) return false;
    if (isConversationalUnavailableNotice(message)) return true;

    const summary = message.executionSummary;
    const stopReason = String(summary?.stopReason || '');
    const planStatus = String((message.agentTaskPlan as any)?.status || '');
    const visibleStateCategory = String((message.agentTaskPlan as any)?.userVisibleState?.category || '');
    const assistantReplyOrigin = normalizeAssistantReplyOriginForDisplay(message.assistantReplyOrigin);
    const feedback = message.businessVisualObservationFeedback;
    const isBlockedOrFailed = summary?.status === 'failed'
        || assistantReplyOrigin.userVisibleKind === 'blocker_notice'
        || stopReason === 'tool_preflight_blocked'
        || planStatus.startsWith('blocked_')
        || visibleStateCategory === 'blocked';
    if (!isBlockedOrFailed) return false;

    const combined = [
        content,
        summary?.summaryText,
        summary?.lastError,
        ...(Array.isArray(summary?.blockers) ? summary.blockers : []),
        collectBusinessFeedbackVisibleText(feedback)
    ].map((item) => safeDiagnosticText(item)).filter(Boolean).join(' ');
    const hasUserActionableMissingCondition = /(当前项目缺少|当前项目里没有|缺少可用|未找到|没有找到|没有可用|没有可分析|请先补齐|需要图片|图片资源|素材|资源|SKU|PSD|PSB|模板|文档|项目目录|文件)/u.test(combined);
    if (!hasUserActionableMissingCondition) return false;

    const contentAlreadyExplainsBlocker = /(还缺少条件|当前项目缺少|当前项目里没有|缺少可用|未找到|没有找到|没有可用|没有可分析|请先补齐|需要图片|图片资源|素材|资源|SKU|PSD|PSB|模板|文档|项目目录|文件)/u.test(content);
    return contentAlreadyExplainsBlocker;
}

function buildPublicPlanExecutionRequestCard(
    request: AgentTaskPublicPlanExecutionRequest | undefined,
    approvalRecord: AgentTaskPublicPlanApprovalRecord | undefined,
    messageId: string,
    index: number
): CardBlock | null {
    if (!request || request.version !== 'agent-task-public-plan-execution-request/v0') return null;

    const isPending = request.status === 'blocked_pending_user_confirmation';
    const isApproved = approvalRecord?.status === 'approved_controlled_execution_request';
    const isReady = request.status === 'ready_for_controlled_execution_request';
    const plannedStepCount = Math.max(request.operationRequests?.length || 0, request.proposedWriteTools?.length || 0);
    const readbackTargetCount = request.readbackTargets?.length || 0;
    const details: CardBlock['details'] = [
        { label: '状态', value: isApproved || isReady ? '准备开始' : safePublicPlanRequestStatus(request.status) },
        { label: '画面动作', value: plannedStepCount > 0 ? `${plannedStepCount} 项` : '待补充' },
        { label: '完成检查', value: readbackTargetCount > 0 ? `${readbackTargetCount} 项` : '待补充' }
    ];
    const designDecision = safePublicPlanDesignText(request.publicPlanSummary);
    const executionIdea = safePublicPlanDesignText(request.executionPlanSummary);
    const title = isApproved
        ? '处理计划已确认'
        : isReady
            ? '准备开始处理'
            : '处理计划待确认';
    const content = isApproved || isReady
        ? designDecision || '已准备好按这份处理计划推进；开始前仍会按计划和检查项执行。'
        : designDecision || '确认后会按这份处理计划推进，并按检查项复核结果。';

    return {
        id: createStableId(messageId, 'public-plan-execution-request', index),
        type: 'card',
        variant: isApproved || isReady ? 'success' : isPending ? 'warning' : 'neutral',
        icon: isApproved || isReady ? '✓' : '!',
        title,
        content,
        details: executionIdea
            ? [...details, { label: '思路', value: executionIdea }]
            : details,
        actions: isPending && !isApproved
            ? [{
                id: createStableId(messageId, 'public-plan-confirm', index),
                label: '确认计划',
                variant: 'primary',
                action: 'confirmPublicPlan',
                params: {
                    sourceMessageId: messageId,
                    requestId: request.requestId
                }
            } as ActionItem]
            : undefined,
        collapsible: true,
        defaultCollapsed: false
    };
}

function buildPublicPlanControlledRunCard(
    run: AgentTaskPublicPlanControlledRun | undefined,
    messageId: string,
    index: number
): CardBlock | null {
    if (!run || run.version !== 'agent-task-public-plan-controlled-runner/v0') return null;

    const isCompleted = run.status === 'completed_dry_run'
        || run.status === 'completed_fake_adapter_verified'
        || run.status === 'completed_live_adapter_verified';
    const isFailed = run.status === 'failed_write_operation'
        || run.status === 'failed_readback';
    const isLiveBlocked = run.status === 'blocked_live_write_permission_missing'
        || run.status === 'blocked_live_adapter_required'
        || run.status === 'blocked_live_operation_params_required';
    const isBlocked = run.status.startsWith('blocked_');
    const variant: CardBlock['variant'] = isCompleted
        ? 'success'
        : isFailed
            ? 'error'
            : isBlocked
                ? 'warning'
                : 'neutral';
    const title = run.status === 'completed_dry_run'
        ? '设计方案已检查'
        : run.status === 'completed_fake_adapter_verified'
            ? '设计方案已检查'
            : run.status === 'completed_live_adapter_verified'
                ? '画面已创建，待复核'
            : isFailed
                ? '处理未完成'
            : isLiveBlocked
                    ? '处理条件不完整'
                    : '尚未开始处理';
    const plannedStepCount = Math.max(run.operationRequests?.length || 0, run.plannedWriteTools?.length || 0);
    const completedStepCount = Math.max(run.operationResults?.length || 0, run.executedWriteTools?.length || 0);
    const readbackTargetCount = run.readbackTargets?.length || run.readbackResults?.length || 0;
    const primaryBlocker = run.blockers.find(Boolean);
    const safePrimaryBlocker = primaryBlocker ? safeDiagnosticText(primaryBlocker) : '';
    const designDecision = safePublicPlanDesignText(run.publicPlanSummary);
    const executionIdea = safePublicPlanDesignText(run.executionPlanSummary);
    const observationDiffSummary = run.observationDiff?.status === 'mismatch'
        ? safePublicPlanDesignText(run.observationDiff.userVisibleSummary)
            || `画面里暂时没有看到「${(run.observationDiff.missingVisibleCopy || [])
                .map((item) => safePublicPlanDesignText(item))
                .filter(Boolean)
                .slice(0, 4)
                .join('」「')}」。`
        : '';
    const content = run.status === 'completed_dry_run'
        ? designDecision || '已检查这份设计方案，本轮没有改动画面。'
        : run.status === 'completed_fake_adapter_verified'
            ? designDecision || '已检查这份设计方案，但没有改动真实画面。'
            : run.status === 'completed_live_adapter_verified'
                ? designDecision || '已按方案创建画面，需要继续复核整体效果。'
                : isLiveBlocked
                ? '当前还缺少必要条件，暂时不能改动画面。'
                : isFailed
                    ? observationDiffSummary
                        ? `复核发现：${observationDiffSummary}`
                        : `处理未完成：${safePrimaryBlocker || '写入或结果检查失败'}`
                    : safePrimaryBlocker || '待处理请求尚未满足启动条件。';

    return {
        id: createStableId(messageId, 'public-plan-controlled-run', index),
        type: 'card',
        variant,
        icon: isCompleted ? '✓' : isFailed ? '×' : '!',
        title,
        content,
        details: [
            { label: '状态', value: safePublicPlanControlledRunStatus(run.status) },
            { label: '画面动作', value: plannedStepCount > 0 ? `${plannedStepCount} 项` : '未开始' },
            { label: '已完成', value: completedStepCount > 0 ? `${completedStepCount} 项` : '0 项' },
            { label: '完成检查', value: readbackTargetCount > 0 ? `${readbackTargetCount} 项` : '待补充' },
            ...(observationDiffSummary ? [{ label: '复核发现', value: observationDiffSummary }] : []),
            ...(executionIdea ? [{ label: '思路', value: executionIdea }] : [])
        ],
        collapsible: true,
        defaultCollapsed: !isFailed && !isLiveBlocked
    };
}

// ==================== 解析函数 ====================

/**
 * 代码块正则（预编译，避免重复创建）
 */
const CODE_BLOCK_REGEX = /```(\w+)?\n([\s\S]*?)```/g;

/**
 * 提取代码块
 */
function extractCodeBlocks(
    content: string, 
    messageId: string,
    startIndex: number
): { blocks: CodeBlock[]; remainingContent: string } {
    const blocks: CodeBlock[] = [];
    let remainingContent = content;
    let blockIndex = startIndex;
    
    // 重置正则状态
    CODE_BLOCK_REGEX.lastIndex = 0;
    
    let match;
    while ((match = CODE_BLOCK_REGEX.exec(content)) !== null) {
        const language = match[1] || 'text';
        const code = match[2].trim();
        
        blocks.push({
            id: createStableId(messageId, 'code', blockIndex++),
            type: 'code',
            language,
            code,
            lineNumbers: true,
            copyable: true
        });
        
        // 用占位符替换代码块
        remainingContent = remainingContent.replace(match[0], `\n[CODE_BLOCK_${blocks.length - 1}]\n`);
    }
    
    return { blocks, remainingContent };
}

/**
 * 检测特殊消息类型
 * 
 * 使用字符码检测，避免多次 startsWith 调用
 */
function detectMessageType(content: string): 'success' | 'warning' | 'error' | 'info' | 'normal' {
    const trimmed = content.trimStart();
    if (trimmed.length === 0) return 'normal';
    
    const firstChar = trimmed.charCodeAt(0);
    
    // ✅ (U+2705) 或 ✓ (U+2713)
    if (firstChar === 0x2705 || firstChar === 0x2713) return 'success';
    
    // ⚠ (U+26A0) - 注意：⚠️ 是两个字符
    if (firstChar === 0x26A0) return 'warning';
    
    // ❌ (U+274C) 或 ✗ (U+2717)
    if (firstChar === 0x274C || firstChar === 0x2717) return 'error';
    
    // ℹ (U+2139)
    if (firstChar === 0x2139) return 'info';
    
    // 中文关键词检测
    if (trimmed.startsWith('警告')) return 'warning';
    if (trimmed.startsWith('错误')) return 'error';
    if (trimmed.startsWith('提示')) return 'info';
    
    return 'normal';
}

/**
 * 提取标题和内容
 */
function extractTitleAndContent(content: string): { title: string; body: string } {
    // 移除开头的 emoji（使用更精确的模式）
    const cleaned = content.replace(/^[\u2705\u2713\u274C\u2717\u26A0\u2139\uFE0F\s]+/, '').trim();
    
    // 检查是否有 **标题** 格式
    const boldMatch = cleaned.match(/^\*\*([^*]+)\*\*\s*([\s\S]*)/);
    if (boldMatch) {
        return { title: boldMatch[1], body: boldMatch[2].trim() };
    }
    
    // 检查是否有冒号分隔
    const colonIndex = cleaned.search(/[：:]/);
    if (colonIndex > 0 && colonIndex < 20) {
        return { 
            title: cleaned.slice(0, colonIndex), 
            body: cleaned.slice(colonIndex + 1).trim() 
        };
    }
    
    return { title: '', body: cleaned };
}

/**
 * 格式化工具结果为人性化摘要
 * 避免向用户暴露原始 JSON 数据
 */
function formatToolResultSummary(toolName: string, result: any): string | undefined {
    if (!result) return undefined;
    
    // 如果是字符串，尝试解析
    let data = result;
    if (typeof result === 'string') {
        try {
            data = JSON.parse(result);
        } catch {
            // 非 JSON 字符串，截取显示
            const cleaned = safeDiagnosticText(result);
            return cleaned.length > 50 ? cleaned.slice(0, 50) + '...' : cleaned;
        }
    }
    
    // 处理常见工具结果模式
    if (typeof data !== 'object' || data === null) {
        return safeDiagnosticText(data);
    }
    
    // 检查是否成功
    const success = data.success !== false;
    
    // 错误消息优先显示
    if (data.error) {
        return safeDiagnosticText(data.error);
    }
    if (data.message && !success) {
        return safeDiagnosticText(data.message);
    }
    if (typeof data.acceptance?.summaryText === 'string') {
        return safeDiagnosticText(data.acceptance.summaryText);
    }
    
    // 根据工具类型生成友好摘要
    switch (toolName) {
        case 'getLayerHierarchy':
            if (data.totalLayers !== undefined) {
                return `文档 "${data.documentName || '当前文档'}"，共 ${data.totalLayers} 个图层`;
            }
            break;
            
        case 'getDocumentInfo':
            if (data.name) {
                return `${data.name} (${data.width}×${data.height})`;
            }
            break;
            
        case 'searchProjectResources':
        case 'listProjectResources':
            if (data.totalFiles !== undefined) {
                return `找到 ${data.totalFiles} 个文件`;
            }
            if (data.results?.length !== undefined) {
                return `找到 ${data.results.length} 个匹配项`;
            }
            if (Array.isArray(data)) {
                return `找到 ${data.length} 个文件`;
            }
            break;
            
        case 'analyzeLayout':
        case 'layout-analyze':
            if (data.layout?.type) {
                return `布局类型: ${data.layout.type}`;
            }
            break;
            
        case 'removeBackground':
        case 'applyMattingResult':
            return success ? '抠图完成' : '抠图失败';
            
        case 'placeImage':
            if (data.layerName) {
                return `已置入图层 "${data.layerName}"`;
            }
            return success ? '图片已置入' : '置入失败';
            
        case 'setTextContent':
        case 'setTextStyle':
            return success ? '文本已更新' : '更新失败';
            
        case 'moveLayer':
        case 'transformLayer':
            return success ? '变换已应用' : '变换失败';

        case 'moveLayerToGroup':
            return success ? '已移动到图层组' : '移动到图层组失败';
            
        case 'createGroup':
        case 'groupLayers':
            if (data.groupName) {
                return `已创建组 "${data.groupName}"`;
            }
            return success ? '已创建组' : '创建失败';
            
        case 'saveDocument':
        case 'quickExport':
        case 'exportGroup':
            if (data.path) {
                const fileName = data.path.split(/[/\\]/).pop();
                return `已保存: ${fileName}`;
            }
            if (data.outputPath) {
                const fileName = data.outputPath.split(/[/\\]/).pop();
                return `已导出: ${fileName}`;
            }
            return success ? '保存成功' : '保存失败';
            
        case 'getSmartObjectInfo':
            if (data.data?.isSmartObject) {
                const linked = data.data.linked ? '链接' : '嵌入';
                return `${linked}型智能对象`;
            }
            break;
            
        case 'convertToSmartObject':
            return success ? '已转换为智能对象' : '转换失败';
            
        case 'editSmartObjectContents':
            return success ? '智能对象已打开编辑' : '打开失败';
    }
    
    // 通用消息字段
    if (data.message && typeof data.message === 'string') {
        const cleaned = safeDiagnosticText(data.message);
        return cleaned.length > 60 ? cleaned.slice(0, 60) + '...' : cleaned;
    }
    
    // 通用成功/失败
    if (success) {
        // 尝试提取有意义的字段
        if (data.name) return data.name;
        if (data.layerName) return `图层: ${data.layerName}`;
        if (data.count !== undefined) return `${data.count} 项`;
        if (data.totalLayers !== undefined) return `${data.totalLayers} 个图层`;
        return '执行成功';
    }
    
    return '执行完成';
}

/**
 * 将旧版可见步骤转换为独立的公开过程 / 工具执行块。
 * 这里展示的是用户可见的意图、观察和复核摘要，不展示私密链路推理。
 */
function isVisibleTimelineStep(step: LegacyThinkingStep): boolean {
    if (step.toolName) return true;
    if (step.type === 'thinking' || step.type === 'decision') {
        return safeThinkingText(step.content).length > 0;
    }
    return typeof step.content === 'string'
        && safeDiagnosticText(step.content).trim().length > 0;
}

function resolveTimelineDuration(steps: LegacyThinkingStep[]): number {
    const timedSteps = steps.flatMap((step) => {
        const timestamp = Number(step.timestamp);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return [];
        const rawDuration = Number(step.duration);
        const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
        return [{ start: timestamp, end: timestamp + duration }];
    });
    if (timedSteps.length > 0) {
        const firstStart = Math.min(...timedSteps.map((step) => step.start));
        const lastEnd = Math.max(...timedSteps.map((step) => step.end));
        return Math.max(0, lastEnd - firstStart);
    }
    return steps.reduce((longest, step) => {
        const duration = Number(step.duration);
        return Number.isFinite(duration) && duration > longest ? duration : longest;
    }, 0);
}

function convertThinkingStepGroup(
    steps: LegacyThinkingStep[],
    messageId: string,
    title: string,
    index: number,
    isStreaming: boolean
): ThinkingBlockType | null {
    const visibleSteps = steps.filter(isVisibleTimelineStep);
    if (visibleSteps.length === 0) return null;

    const thinkingSteps = visibleSteps.map(step => {
        let icon = '🔧';
        let label = step.type === 'thinking' || step.type === 'decision'
            ? safeThinkingText(step.content || '')
            : safeDiagnosticText(step.content || '');
        const isToolStep = Boolean(step.toolName)
            || step.type === 'tool_call'
            || step.type === 'tool_result';
        const displayRole = resolveThinkingStepDisplayRole({
            type: step.type,
            toolName: step.toolName,
            tone: isToolStep ? 'action' : 'thought'
        });
        
        if (step.toolName) {
            const info = getToolDisplayInfo(step.toolName);
            icon = info.icon;
            label = info.name;
        } else if (step.type === 'thinking' || step.type === 'decision') {
            icon = '💭';
        } else if (step.type === 'status') {
            icon = '⏳';
        } else if (step.type === 'reading') {
            icon = '📖';
            if (step.filePath) {
                label = `读取 ${step.filePath}${step.lineRange ? ` ${step.lineRange}` : ''}`;
            }
        } else if (step.type === 'exploring') {
            icon = '🔍';
        } else if (step.type === 'analyzing') {
            icon = '📊';
        }
        
        return {
            id: step.id,
            label,
            icon,
            status: step.status,
            tone: isToolStep ? 'action' as const : 'thought' as const,
            displayRole,
            roleLabel: resolveThinkingStepRoleLabel(displayRole, step.type),
            sourceType: step.type,
            actionLabel: isToolStep
                ? step.status === 'error'
                    ? '未完成'
                    : step.status === 'running' || step.status === 'pending'
                        ? '正在处理'
                        : '已处理'
                : undefined,
            detail: step.toolResult ? formatToolResultSummary(step.toolName || '', step.toolResult) : undefined,
            duration: step.duration
        };
    });
    
    const totalDuration = resolveTimelineDuration(visibleSteps);
    
    return {
        id: createStableId(messageId, 'thinking', index),
        type: 'thinking',
        title,
        steps: thinkingSteps,
        // 过程在运行中保持可见；历史 / 完成 / 失败终态默认只显示一行摘要。
        // MessageRenderer 还会用 active/terminal key 处理同一消息的运行态切换。
        isExpanded: isStreaming,
        totalDuration
    };
}

function convertThinkingSteps(steps: LegacyThinkingStep[], messageId: string, isStreaming = false): ThinkingBlockType[] {
    const normalizedSteps = normalizeHistoricalThinkingSteps(steps, isStreaming);
    const timelineSteps = normalizedSteps.filter((step) => (
        step.type === 'thinking'
        || step.type === 'decision'
        || step.type === 'status'
        || step.type === 'reading'
        || step.type === 'exploring'
        || step.type === 'analyzing'
        || step.type === 'tool_call'
        || step.type === 'tool_result'
    ));
    const visibleTimelineSteps = timelineSteps.filter(isVisibleTimelineStep);
    return [
        convertThinkingStepGroup(
            visibleTimelineSteps,
            messageId,
            resolveThinkingBlockTitle(visibleTimelineSteps, isStreaming),
            0,
            isStreaming
        )
    ].filter((block): block is ThinkingBlockType => Boolean(block));
}

function resolveThinkingBlockTitle(steps: LegacyThinkingStep[], isStreaming = false): string {
    const hasProcessStep = steps.some((step) => step.type !== 'tool_call' && step.type !== 'tool_result');
    const hasToolStep = steps.some((step) => step.type === 'tool_call' || step.type === 'tool_result');
    if (!isStreaming) {
        if (hasProcessStep && hasToolStep) return '判断与处理';
        if (hasToolStep) return '处理';
        return '思考';
    }
    const hasActiveStep = steps.some((step) => step.status === 'running' || step.status === 'pending');
    if (hasActiveStep && hasProcessStep && hasToolStep) return '正在判断和处理';
    if (hasActiveStep && hasToolStep) return '正在处理';
    if (hasActiveStep) return '正在思考';
    if (hasProcessStep && hasToolStep) return '判断与处理';
    if (hasToolStep) return '处理';
    return '思考';
}

/**
 * 将工具调用结果转换为结果块
 */
function convertToolResult(step: LegacyThinkingStep, messageId: string, index: number): ToolResultBlock | null {
    if (step.type !== 'tool_result' || !step.toolName) return null;
    
    const info = getToolDisplayInfo(step.toolName);
    
    return {
        id: createStableId(messageId, 'tool_result', index),
        type: 'tool_result',
        toolName: step.toolName,
        displayName: info.name,
        icon: info.icon,
        success: step.status === 'success',
        result: step.toolResult,
        error: step.status === 'error' ? (safeDiagnosticText(step.content || '执行失败') || '执行失败') : undefined,
        duration: step.duration,
        details: step.toolResult ? parseToolResultDetails(step.toolResult) : undefined,
        actions: buildToolResultActions(step, messageId, index)
    };
}

function buildToolResultActions(step: LegacyThinkingStep, messageId: string, index: number): ActionItem[] | undefined {
    const actions: ActionItem[] = [];
    const summary = formatToolResultSummary(step.toolName || '', step.toolResult);

    if (summary) {
        actions.push({
            id: createStableId(messageId, 'tool-result-copy', index + 101),
            label: '复制摘要',
            icon: '📋',
            variant: 'secondary',
            action: 'copyText',
            params: withActionPayload({ text: summary })
        });
    }

    return actions.length > 0 ? actions : undefined;
}

const PUBLIC_TOOL_RESULT_FIELD_MAP: Record<string, { label: string; type?: 'text' | 'code' | 'link' }> = {
    name: { label: '名称' },
    documentName: { label: '文档' },
    layerName: { label: '图层' },
    type: { label: '类型' },
    count: { label: '数量' },
    size: { label: '大小' },
    width: { label: '宽度' },
    height: { label: '高度' },
    totalFiles: { label: '文件数量' },
    totalLayers: { label: '图层数量' },
    success: { label: '结果' },
    error: { label: '错误' },
    message: { label: '消息' }
};

/**
 * 解析工具结果详情
 */
function parseToolResultDetails(result: any): Array<{ label: string; value: string | number; type?: 'text' | 'code' | 'link' }> | undefined {
    if (!result || typeof result !== 'object') return undefined;
    
    const details: Array<{ label: string; value: string | number; type?: 'text' | 'code' | 'link' }> = [];
    if (typeof result.acceptance?.summaryText === 'string') {
        details.push({
            label: '验收',
            value: safeDiagnosticText(result.acceptance.summaryText),
            type: 'text'
        });
    }

    for (const [key, value] of Object.entries(result)) {
        if (key === 'acceptance') continue;
        if (value === null || value === undefined) continue;
        if (typeof value === 'object') continue;
        const publicField = PUBLIC_TOOL_RESULT_FIELD_MAP[key];
        const label = publicField?.label;
        if (!label) continue;

        const displayValue = typeof value === 'boolean' 
            ? (value ? '是' : '否')
            : safeDiagnosticText(value);
        
        details.push({
            label,
            value: displayValue,
            type: publicField.type || 'text'
        });
        
        // 限制详情数量
        if (details.length >= 6) break;
    }
    
    return details.length > 0 ? details : undefined;
}

/**
 * 解析消息内容为内容块
 */
function parseMessageContentInternal(
    content: string, 
    messageId: string,
    startBlockIndex: number,
    detectStatusCard = true
): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    let blockIndex = startBlockIndex;
    
    // 1. 提取代码块
    const { blocks: codeBlocks, remainingContent } = extractCodeBlocks(content, messageId, blockIndex);
    blockIndex += codeBlocks.length;
    
    // 2. 检测消息类型
    const messageType = detectStatusCard ? detectMessageType(remainingContent) : 'normal';
    
    // 3. 如果是特殊类型消息，转换为卡片
    if (messageType !== 'normal') {
        const { title, body } = extractTitleAndContent(remainingContent);
        
        // 如果有代码块，需要将它们插入回正确位置
        if (codeBlocks.length > 0 && body.includes('[CODE_BLOCK_')) {
            const parts = body.split(/\[CODE_BLOCK_(\d+)\]/);
            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 0) {
                    if (parts[i].trim()) {
                        blocks.push({
                            id: createStableId(messageId, 'card', blockIndex++),
                            type: 'card',
                            variant: messageType,
                            title: i === 0 ? title : undefined,
                            content: parts[i].trim()
                        } as CardBlock);
                    }
                } else {
                    const codeIndex = parseInt(parts[i], 10);
                    if (codeBlocks[codeIndex]) {
                        blocks.push(codeBlocks[codeIndex]);
                    }
                }
            }
        } else {
            blocks.push({
                id: createStableId(messageId, 'card', blockIndex++),
                type: 'card',
                variant: messageType,
                title,
                content: body.replace(/\[CODE_BLOCK_\d+\]/g, '').trim()
            } as CardBlock);
            
            blocks.push(...codeBlocks);
        }
    } else {
        // 4. 普通消息
        if (codeBlocks.length > 0 && remainingContent.includes('[CODE_BLOCK_')) {
            const parts = remainingContent.split(/\[CODE_BLOCK_(\d+)\]/);
            for (let i = 0; i < parts.length; i++) {
                if (i % 2 === 0) {
                    if (parts[i].trim()) {
                        blocks.push({
                            id: createStableId(messageId, 'text', blockIndex++),
                            type: 'text',
                            content: parts[i].trim(),
                            format: 'markdown'
                        } as TextBlock);
                    }
                } else {
                    const codeIndex = parseInt(parts[i], 10);
                    if (codeBlocks[codeIndex]) {
                        blocks.push(codeBlocks[codeIndex]);
                    }
                }
            }
        } else {
            blocks.push({
                id: createStableId(messageId, 'text', blockIndex++),
                type: 'text',
                content: remainingContent,
                format: 'markdown'
            } as TextBlock);
        }
    }
    
    return blocks;
}


/**
 * 解析消息内容为内容块
 */
export function parseMessageContent(content: string, options: ParseOptions = {}): ContentBlock[] {
    // 使用时间戳作为临时 ID（用于非缓存场景）
    return parseMessageContentInternal(content, `temp-${Date.now()}`, 0);
}

/**
 * 将旧版消息转换为多模态消息
 * 
 * 性能优化：
 * - 使用 WeakMap 缓存转换结果
 * - 通过内容哈希检测变化
 * - 缓存命中时直接返回，避免重复计算
 */
export function convertLegacyMessage(message: LegacyMessage): MultimodalMessage {
    // 检查缓存
    const cached = conversionCache.get(message);
    const contentHash = hashString(message.content || '');
    const thinkingStepsLength = message.thinkingSteps?.length ?? 0;
    const thinkingStepsHash = buildThinkingStepsHash(message.thinkingSteps);
    const isThinking = message.isThinking === true;
    const hasImage = !!message.image;
    const executionSummaryHash = message.executionSummary
        ? hashString(JSON.stringify(message.executionSummary))
        : '';
    const businessVisualObservationFeedbackHash = message.businessVisualObservationFeedback
        ? hashString(JSON.stringify(message.businessVisualObservationFeedback))
        : '';
    const agentTaskPlanUserVisibleStateHash = message.agentTaskPlan?.userVisibleState
        ? hashString(JSON.stringify(message.agentTaskPlan.userVisibleState))
        : '';
    const agentTaskPlanPresentationHash = message.agentTaskPlanPresentation
        ? hashString(JSON.stringify(message.agentTaskPlanPresentation))
        : '';
    const publicPlanExecutionRequestHash = message.agentTaskPublicPlanExecutionRequest
        ? hashString(JSON.stringify(message.agentTaskPublicPlanExecutionRequest))
        : '';
    const publicPlanApprovalRecordHash = message.agentTaskPublicPlanApprovalRecord
        ? hashString(JSON.stringify(message.agentTaskPublicPlanApprovalRecord))
        : '';
    const publicPlanControlledRunHash = message.agentTaskPublicPlanControlledRun
        ? hashString(JSON.stringify(message.agentTaskPublicPlanControlledRun))
        : '';
    const skuDeliverySummaryHash = message.skuDeliverySummary
        ? hashString(JSON.stringify(message.skuDeliverySummary))
        : '';
    const interactiveCardsHash = Array.isArray(message.interactiveCards) && message.interactiveCards.length > 0
        ? hashString(JSON.stringify(message.interactiveCards))
        : '';
    const interactiveCardSubmissionsHash = Array.isArray(message.interactiveCardSubmissions)
        && message.interactiveCardSubmissions.length > 0
        ? hashString(JSON.stringify(message.interactiveCardSubmissions))
        : '';
    const assistantReplyOriginHash = message.assistantReplyOrigin
        ? hashString(JSON.stringify(message.assistantReplyOrigin))
        : '';
    const agentResponseInterruption = resolveAgentResponseInterruption({
        interruption: message.agentResponseInterruption,
        assistantReplyOrigin: message.assistantReplyOrigin,
        content: message.content
    });
    const agentResponseInterruptionHash = agentResponseInterruption
        ? hashString(JSON.stringify(agentResponseInterruption))
        : '';
    
    // 缓存命中且内容未变化
    if (cached && 
        cached.contentHash === contentHash &&
        cached.thinkingStepsLength === thinkingStepsLength &&
        cached.thinkingStepsHash === thinkingStepsHash &&
        cached.isThinking === isThinking &&
        cached.hasImage === hasImage &&
        cached.executionSummaryHash === executionSummaryHash &&
        cached.businessVisualObservationFeedbackHash === businessVisualObservationFeedbackHash &&
        cached.agentTaskPlanUserVisibleStateHash === agentTaskPlanUserVisibleStateHash &&
        cached.agentTaskPlanPresentationHash === agentTaskPlanPresentationHash &&
        cached.publicPlanExecutionRequestHash === publicPlanExecutionRequestHash &&
        cached.publicPlanApprovalRecordHash === publicPlanApprovalRecordHash &&
        cached.publicPlanControlledRunHash === publicPlanControlledRunHash &&
        cached.skuDeliverySummaryHash === skuDeliverySummaryHash &&
        cached.interactiveCardsHash === interactiveCardsHash &&
        cached.interactiveCardSubmissionsHash === interactiveCardSubmissionsHash &&
        cached.assistantReplyOriginHash === assistantReplyOriginHash &&
        cached.agentResponseInterruptionHash === agentResponseInterruptionHash) {
        return cached.result;
    }
    
    // 执行转换
    const blocks: ContentBlock[] = [];
    let blockIndex = 0;
    const compactFailureView = shouldUseCompactAssistantFailureView(message);
    const taskPlanPresentationBlock = buildAgentTaskPlanPresentationBlock(
        message.agentTaskPlanPresentation,
        message.id,
        blockIndex
    );
    
    // 1. 如果有图片，添加图片块
    if (message.image) {
        blocks.push({
            id: createStableId(message.id, 'image', blockIndex++),
            type: 'image',
            src: `data:${message.image.type};base64,${message.image.data}`,
            alt: '附件图片',
            zoomable: true
        } as ImageBlock);
    }

    if (taskPlanPresentationBlock) {
        blocks.push({
            ...taskPlanPresentationBlock,
            id: createStableId(message.id, 'task-plan', blockIndex++)
        });
    }

    const hasUnifiedTaskPlanPresentation = Boolean(taskPlanPresentationBlock);
    const hasAuthoritativeNonCompletedResult = Boolean(
        message.executionSummary
        && message.executionSummary.status !== 'completed'
    );
    const hasRequiredUserVisibleAction = message.agentTaskPlan?.userVisibleState?.userActionRequired === true;
    const hasPublicPlanConfirmationAction = (
        message.agentTaskPublicPlanExecutionRequest?.status === 'blocked_pending_user_confirmation'
    );
    const controlledRunStatus = String(message.agentTaskPublicPlanControlledRun?.status || '');
    const controlledRunIsEquivalentTerminal = controlledRunStatus === 'not_applicable'
        || controlledRunStatus.startsWith('completed_');

    const suppressCompletedExecutionSummary = shouldSuppressCompletedExecutionSummaryCard(message);
    const executionSummaryCard = compactFailureView
        || suppressCompletedExecutionSummary
        || (hasUnifiedTaskPlanPresentation && !hasAuthoritativeNonCompletedResult)
        ? null
        : buildExecutionSummaryCard(message.executionSummary, message.id, blockIndex);
    if (executionSummaryCard) {
        blocks.push(executionSummaryCard);
        blockIndex++;
    }

    const agentUserVisibleStateCard = compactFailureView
        || (!hasRequiredUserVisibleAction && (
            hasUnifiedTaskPlanPresentation
            || shouldSuppressAgentUserVisibleStateCard(message)
        ))
        ? null
        : buildAgentUserVisibleStateCard(message.agentTaskPlan, message.id, blockIndex);
    if (agentUserVisibleStateCard) {
        blocks.push(agentUserVisibleStateCard);
        blockIndex++;
    }

    const visualObservationFeedbackCard = compactFailureView ? null : buildBusinessVisualObservationFeedbackCard(
        message.businessVisualObservationFeedback,
        message.id,
        blockIndex
    );
    if (visualObservationFeedbackCard) {
        blocks.push(visualObservationFeedbackCard);
        blockIndex++;
    }

    const publicPlanExecutionRequestCard = (compactFailureView && !hasPublicPlanConfirmationAction)
        || (hasUnifiedTaskPlanPresentation && !hasPublicPlanConfirmationAction)
        ? null
        : buildPublicPlanExecutionRequestCard(
        message.agentTaskPublicPlanExecutionRequest,
        message.agentTaskPublicPlanApprovalRecord,
        message.id,
        blockIndex
    );
    if (publicPlanExecutionRequestCard) {
        blocks.push(publicPlanExecutionRequestCard);
        blockIndex++;
    }

    const publicPlanControlledRunCard = compactFailureView
        || (hasUnifiedTaskPlanPresentation && controlledRunIsEquivalentTerminal)
        ? null
        : buildPublicPlanControlledRunCard(
        message.agentTaskPublicPlanControlledRun,
        message.id,
        blockIndex
    );
    if (publicPlanControlledRunCard) {
        blocks.push(publicPlanControlledRunCard);
        blockIndex++;
    }

    const skuDeliverySummaryBlocks = buildSkuDeliverySummaryBlocks(
        message.skuDeliverySummary,
        message.id,
        blockIndex
    );
    if (skuDeliverySummaryBlocks.length > 0) {
        blocks.push(...skuDeliverySummaryBlocks);
        blockIndex += skuDeliverySummaryBlocks.length;
    }

    // 2. 如果有思维步骤，添加思考块
    if (!compactFailureView && shouldRenderPersistentThinkingSteps(message)) {
        const thinkingSteps = message.thinkingSteps || [];
        const thinkingBlocks = convertThinkingSteps(thinkingSteps, message.id, message.isThinking === true);
        for (const thinkingBlock of thinkingBlocks) {
            blocks.push(thinkingBlock);
            blockIndex++;
        }
        
        // 添加工具执行结果
        const resultSteps = thinkingSteps.filter(s => s.type === 'tool_result');
        for (const step of resultSteps) {
            const resultBlock = convertToolResult(step, message.id, blockIndex++);
            if (resultBlock) {
                blocks.push(resultBlock);
            }
        }
    }


    const suppressInterruptionSentinel = Boolean(
        agentResponseInterruption
        && isAgentResponseInterruptionSentinelContent(message.content)
    );
    if (
        message.content
        && !suppressInterruptionSentinel
        && !shouldSkipPlainContentForSkuDelivery(message.content, message.skuDeliverySummary)
    ) {
        const content = message.role === 'assistant'
            ? normalizeAgentResponsePresentation(sanitizeUserVisibleAssistantBodyText(message.content))
            : message.content;
        const originNoticeBlock = content
            ? buildOriginNoticeContentBlock(content, message, blockIndex)
            : null;
        if (originNoticeBlock) {
            blocks.push(originNoticeBlock);
            blockIndex++;
        } else {
            const contentBlocks = content
                ? parseMessageContentInternal(content, message.id, blockIndex, false)
                : [];
            blocks.push(...contentBlocks);
        }
    }

    // 交互确认卡片放在整条消息最底部：它是用户当下要操作的对象，必须在过程步骤/说明文字之下，
    // 不能出现在"判断/处理"过程块之上（否则用户要往上翻才能找到确认卡片）。
    if (Array.isArray(message.interactiveCards) && message.interactiveCards.length > 0) {
        const submissionsByCardId = new Map(
            (message.interactiveCardSubmissions || []).map((submission) => [submission.cardId, submission])
        );
        for (const card of message.interactiveCards) {
            if (!card || card.version !== 'interactive-card/v0') continue;
            blocks.push({
                id: createStableId(message.id, `interactive-card-${card.id}`, blockIndex++),
                type: 'interactive_card',
                card,
                sourceMessageId: message.id,
                submission: submissionsByCardId.get(card.id)
            } as InteractiveCardBlock);
        }
    }

    const result: MultimodalMessage = {
        id: message.id,
        role: message.role,
        timestamp: message.timestamp,
        blocks,
        isStreaming: isThinking,
        metadata: agentResponseInterruption
            ? { agentResponseInterruption }
            : undefined
    };
    
    // 存入缓存
    conversionCache.set(message, {
        result,
        contentHash,
        thinkingStepsLength,
        thinkingStepsHash,
        isThinking,
        hasImage,
        executionSummaryHash,
        businessVisualObservationFeedbackHash,
        agentTaskPlanUserVisibleStateHash,
        agentTaskPlanPresentationHash,
        publicPlanExecutionRequestHash,
        publicPlanApprovalRecordHash,
        publicPlanControlledRunHash,
        skuDeliverySummaryHash,
        interactiveCardsHash,
        interactiveCardSubmissionsHash,
        assistantReplyOriginHash,
        agentResponseInterruptionHash
    });
    
    return result;
}
