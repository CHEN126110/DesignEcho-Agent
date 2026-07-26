import { getSkillExecutor, executeSkillWithExecutor } from '../skill-executors';
import { executeSkillTool } from '../skill-executors/skill-tools';
import type {
    AgentContext,
    AgentResult,
    AgentUserVisibleNotice,
    LightweightIntent,
    ProcessOptions
} from '../agent-orchestration/types';
import {
    debugInferDecisionFromText,
    detectLightweightIntent,
    fastDeterministicRoute,
    getAgentMattingPausedMessage,
    inferSkillHint,
    isAgentPanelDebugIntent,
    isAgentMattingPaused,
    isDetailTemplateAuthoringIntent,
    isDocumentManagementIntent,
    isLayoutReplicationIntent,
    isMainImageDesignIntent,
    isMainImageTemplateAuthoringIntent,
    isMatteIntent,
    isRetryFeedbackIntent,
    isLocalFirstConversationalIntent,
    isModelFirstConversationalIntent,
    isSkuIntent,
    isSkillEnabled,
    isTemplateSaveIntent,
    normalizeSkillId
} from '../agent-orchestration/routing';
import {
    buildLocalConversationalReply,
    captureExplicitPreferenceFeedback,
    tryConversationalModelReplyDetailed,
    type ConversationalModelFailure,
    type ConversationalModelFailureKind,
    type ConversationalModelReplyDetailedResult
} from '../agent-orchestration/conversational';
import {
    sanitizeUserVisibleAssistantBodyText,
    sanitizeUserVisibleThinkingText
} from '../../../shared/chat-response-cleaner';
import { detectClarificationFollowupContext } from '../agent-orchestration/clarification-followup';
import { getPhotoshopContext } from '../agent-orchestration/context';
import { classifyActionableIntent } from '../agent-orchestration/task-classifier';
import {
    recordPublicPlanRoutingDivergence,
    type PublicPlanRoutingApproach
} from '../../../shared/intent-shadow-diagnostics';
import { toAgentImageAttachments } from '../../../shared/design-image-input';
import { isRegisteredDesignTaskTypeId } from '../../../shared/design-task-types';
import { applySharedSkillParamDefaults } from '../../../shared/skill-param-defaults';
import { findUniqueSkillRoutingIntent } from '../../../shared/skill-routing';
import {
    getSkillById,
    isControlledRouteAutonomousEntrySkill,
    isModelDirectExecutionForbiddenSkill
} from '../../../shared/skills/skill-declarations';
import {
    buildRuntimeSelectedSkillHandoff,
    type RuntimeSelectedSkillHandoff
} from '../../../shared/agent-runtime-v5/runtime-selected-skill-handoff';
import { buildAgentOperatingProfilePromptSection } from '../../../shared/agent-runtime-v5/agent-operating-profile';
import {
    compileOperatingContextPrompt,
    resolveOperatingPhotoshopConnection,
    resolveOperatingPhotoshopDocumentPresence
} from '../../../shared/agent-runtime-v5/operating-context-snapshot';
import {
    buildAgentRequestLifecycle,
    withAgentRequestLifecycle,
    type AgentRequestExecutionKind,
    type AgentRequestLifecycleRecord,
    type AgentRequestRoute,
    type AgentRequestRouteSource
} from '../../../shared/agent-request-lifecycle';
import { buildAgentIntentDeliberationGate } from '../../../shared/agent-intent-deliberation-gate';
import {
    evaluateDeterministicNonExecutionProtection,
    evaluateDeterministicRouteVeto,
    evaluateSimpleDeterministicRouteBoundary,
    isCoordinatorWorkflowShortPathSkill,
    isMetadataOnlyProjectInventoryRoute,
    shouldEnterConversationalRoute,
    type RouteBoundaryDecision
} from '../../../shared/agent-route-boundary-policy';
import { buildAgentResumableTaskContract } from '../../../shared/agent-resumable-task-contract';
import { buildAgentResumeExecutionPolicy } from '../../../shared/agent-resume-execution-policy';
import { buildAgentResumeContextGate, buildAgentResumeContextRefreshRun, runAgentResumeReadonlyContextExecutor } from '../../../shared/agent-resume-context-pipeline';
import {
    buildAgentResumePlanningResult,
    buildAgentResumePlanningMessages
} from '../../../shared/agent-resume-planning';
import {
    buildAgentResumeExecutionGate,
    DEFAULT_AGENT_RESUME_WRITE_TOOL_ALLOWLIST
} from '../../../shared/agent-resume-execution-gate';
import {
    buildAgentResumeControlledExecutionRequest,
    runAgentResumeControlledExecutionRunner
} from '../../../shared/agent-resume-controlled-execution';
import {
    buildAgentIntentControlPlaneDecision,
    buildAutonomousExecutionDecisionForEngine,
    hasExplicitTeamPipelineIntent,
    isConfirmedToolRequiredIntent,
    isAgentSkillCapabilityQuestion,
    type AgentIntentControlPlaneDecision
} from '../../../shared/agent-intent-control-plane';
import {
    buildAgentTaskPlanningContract,
    type AgentTaskPlanningContract
} from '../../../shared/agent-task-planning-contract';
import {
    buildAgentUserVisibleState,
    getInternalAgentStatusPublicMessage
} from '../../../shared/agent-user-visible-state';
import { buildConversationalUnavailableMessage } from '../../../shared/conversational-unavailable-message';
import {
    resolveInteractiveContinuationMutationState,
    type InteractiveContinuationMutationState
} from '../../../shared/interactive-continuation-operation';
import {
    resolveInteractiveContinuationOperationRequest
} from '../../../shared/pending-interactive-continuation';
import {
    beginInteractiveContinuationOperation,
    getInteractiveContinuationOperation,
    settleInteractiveContinuationOperation
} from '../interactive-continuation-operation-client';
import {
    deterministicBlockerReplyOrigin,
    modelAuthoredReplyOrigin,
    modelRepairedReplyOrigin,
    toolSummaryReplyOrigin,
    uiStatusReplyOrigin,
    type AssistantReplyOrigin
} from '../../../shared/assistant-reply-origin';
import {
    buildModelMediatedSkillReplyMessages,
    requiresModelMediatedUserReply
} from '../../../shared/agent-user-reply-mediation-policy';
import {
    buildAgentDesignExecutionPreflight,
    shouldApplyAgentDesignExecutionPreflight,
    type AgentDesignExecutionPreflight
} from '../../../shared/agent-design-execution-preflight';
import { hasSkuNoteDisableIntent } from '../../../shared/sku-intent-params';
import {
    buildAgentTaskPublicPlanReadonlyContext,
    formatAgentTaskPublicPlanReadonlyContext,
    resolveProjectLabelForPublicPlan,
    type AgentTaskPublicPlanReadonlyContext
} from '../../../shared/agent-task-public-plan-readonly-context';
import {
    buildAgentTaskPublicPlanExecutionRequest,
    DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST,
    type AgentTaskPublicPlanControlledOperationRequest
} from '../../../shared/agent-task-public-plan-execution-request';
import { buildAgentTaskPublicPlanApprovalRecord } from '../../../shared/agent-task-public-plan-approval-record';
import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import { extractModelJsonObject } from '../../../shared/model-json-extract';
import {
    collectAgentTaskPublicPlanOperationParamBlockers,
    runAgentTaskPublicPlanControlledRunnerAsync,
    type AgentTaskPublicPlanControlledRun
} from '../../../shared/agent-task-public-plan-controlled-runner';
import {
    buildAgentReActObservationFromPublicPlanRun,
    buildAgentReActObservationFromSkillResult,
    type AgentReActObservation
} from '../../../shared/agent-react-observation-contract';
import {
    buildDesignIntelligenceProjectContextSummary,
    type DesignIntelligenceAgentDecision,
    type DesignIntelligenceWorkflowPhase,
    type DesignIntelligenceWorkflowStep
} from '../../../shared/design-intelligence-plan';
import { buildProjectDesignUnderstandingSummary } from '../../../shared/project-design-understanding-summary';
function buildInteractiveContinuationExecutionRunId(
    requestId: string | undefined,
    continuationId: string
): string {
    const normalizedRequestId = String(requestId || '').trim();
    if (normalizedRequestId) return normalizedRequestId;
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return `interactive-continuation-${globalThis.crypto.randomUUID()}`;
    }
    const fallbackNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `interactive-continuation-${String(continuationId || 'unknown').trim()}-${fallbackNonce}`;
}

function isClearlyBrokenThinking(text?: string): boolean {
    const value = String(text || '').trim();
    if (!value) return true;
    if (/[?？]{3,}/.test(value)) return true;
    if (value.includes(String.fromCodePoint(0xFFFD))) return true;
    if (/^[?？.\s…!！,，:：;；-]+$/.test(value)) return true;
    return false;
}

function resolveModelThinking(modelThinking?: string): string {
    const trimmed = String(modelThinking || '').trim();
    if (!isClearlyBrokenThinking(trimmed)) {
        return trimmed;
    }
    return '';
}

function extractModelVisibleText(response: unknown): string {
    if (typeof response === 'string') {
        return resolveModelThinking(response);
    }
    if (!response || typeof response !== 'object') return '';
    const record = response as Record<string, unknown>;
    for (const key of ['text', 'message', 'content', 'thinking']) {
        const value = record[key];
        if (typeof value !== 'string') continue;
        const text = resolveModelThinking(value);
        if (text) return text;
    }
    return '';
}

function resolveIntentSummary(decision?: { intentSummary?: string; thinking?: string } | null): string {
    return resolveModelThinking(decision?.intentSummary || decision?.thinking);
}

function resolveConversationalUnavailableMessage(
    intent: LightweightIntent,
    context: AgentContext,
    kind: 'auth' | 'rate_limit' | 'network' | 'unknown' = 'unknown'
): string {
    const audience = intent === 'capability' || isAgentSkillCapabilityQuestion(context.userInput)
        ? 'capability'
        : 'general';
    return buildConversationalUnavailableMessage({ audience, kind });
}
function isStructuredRouterLikeText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
    return /"route"\s*:/.test(trimmed) || /"skillId"\s*:/.test(trimmed);
}

function isToolCallLikeText(text: string): boolean {
    const value = String(text || '');
    return /<\s*tool_call\b/i.test(value)
        || /<\/\s*tool_call\s*>/i.test(value)
        || /<\s*function\s*=/i.test(value)
        || /<\/\s*function\s*>/i.test(value)
        || /\btool_use\b/i.test(value);
}

function parseJsonObjectBlock(text: string): Record<string, unknown> | null {
    const extracted = extractModelJsonObject(text);
    const value = extracted?.value;
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function emitIntentStatus(callbacks: ProcessOptions['callbacks'], intentSummary: string): void {
    const summary = sanitizeUserVisibleThinkingText(intentSummary).trim();
    if (!summary) return;

    callbacks?.onThinking?.(summary, { source: 'model_visible_reasoning' });
    callbacks?.onStep?.({
        kind: 'model_response',
        title: '意图判断',
        detail: summary,
        status: 'success',
        percent: 18
    });
    callbacks?.onStatus?.(`意图判断：${summary}`);
}

async function requestInitialVisibleIntentPreview(
    context: AgentContext,
    callModel: NonNullable<ProcessOptions['callModel']>,
    callbacks: ProcessOptions['callbacks']
): Promise<boolean> {
    if (!callbacks?.onThinking) return false;

    const prompt = [
        '请输出一段给用户看的公开判断，用于说明你准备如何理解并处理这条 Photoshop 设计请求。',
        '要求：',
        '1. 使用简体中文，1 到 2 句。',
        '2. 只说明你对用户意图的理解、需要先确认的上下文、准备先做什么。',
        '3. 不要输出 JSON，不要列工具名，不要说已经完成。',
        '4. 不要暴露私有链式思维，不要编造已经读取到的 Photoshop 状态。',
        '',
        `用户请求：${context.userInput}`
    ].join('\n');

    try {
        const response = await callModel(
            [
                {
                    role: 'system',
                    content: [
                        'You are DesignEcho Agent.',
                        'Return only a short public, user-visible reasoning summary in Chinese.',
                        'Do not call tools. Do not output JSON. Do not reveal private chain-of-thought.'
                    ].join('\n')
                },
                { role: 'user', content: prompt }
            ],
            {
                temperature: 0.2,
                maxTokens: 180,
                purpose: 'visible_reasoning',
                stream: true
            }
        );
        const text = sanitizeUserVisibleThinkingText(resolveModelThinking(response?.text || ''));
        if (text && !isStructuredRouterLikeText(text) && !isToolCallLikeText(text)) {
            callbacks.onThinking(text, { source: 'model_visible_reasoning' });
            return true;
        }
    } catch (error) {
        console.warn('[DesignAgentEngine] visible intent preview failed; continue with router:', error);
    }
    return false;
}
function cleanDecisionString(value: unknown): string | undefined {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text || undefined;
}

function cleanDecisionStrings(value: unknown, limit = 8): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(cleanDecisionString).filter(Boolean) as string[])).slice(0, limit);
}

function pickObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isDesignWorkflowPhase(value: unknown): value is DesignIntelligenceWorkflowPhase {
    return ['inspect', 'analyze', 'plan', 'retouch', 'compose', 'export', 'verify'].includes(String(value || ''));
}

function normalizeModelDesignWorkflow(value: unknown): DesignIntelligenceWorkflowStep[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): DesignIntelligenceWorkflowStep | null => {
            const record = pickObject(item);
            const phase = record.phase;
            const goal = cleanDecisionString(record.goal);
            if (!isDesignWorkflowPhase(phase) || !goal) return null;
            return {
                phase,
                goal,
                allowedToolKinds: cleanDecisionStrings(record.allowedToolKinds, 8),
                requiredInputs: cleanDecisionStrings(record.requiredInputs, 8)
            };
        })
        .filter((item): item is DesignIntelligenceWorkflowStep => Boolean(item))
        .slice(0, 12);
}

function normalizeModelDesignDecisionPayload(value: unknown): DesignIntelligenceAgentDecision | null {
    const record = pickObject(value);
    const hierarchy = pickObject(record.hierarchy);
    const color = pickObject(record.color);
    const typography = pickObject(record.typography);
    const retouch = pickObject(record.retouch);
    const assetSelection = pickObject(record.assetSelection);
    const decision: DesignIntelligenceAgentDecision = {
        source: 'model-agent',
        designGoal: cleanDecisionString(record.designGoal),
        productUnderstanding: cleanDecisionStrings(record.productUnderstanding, 8),
        audience: cleanDecisionString(record.audience),
        hierarchy: {
            primarySubject: cleanDecisionString(hierarchy.primarySubject),
            focalPoint: cleanDecisionString(hierarchy.focalPoint),
            informationPriority: cleanDecisionStrings(hierarchy.informationPriority, 8),
            whitespaceIntent: cleanDecisionString(hierarchy.whitespaceIntent),
            layoutNotes: cleanDecisionStrings(hierarchy.layoutNotes, 8)
        },
        color: {
            paletteIntent: cleanDecisionString(color.paletteIntent),
            primaryColors: cleanDecisionStrings(color.primaryColors, 8),
            accentColors: cleanDecisionStrings(color.accentColors, 8),
            backgroundDirection: cleanDecisionString(color.backgroundDirection),
            contrastPlan: cleanDecisionString(color.contrastPlan),
            avoid: cleanDecisionStrings(color.avoid, 8)
        },
        typography: {
            tone: cleanDecisionString(typography.tone),
            hierarchy: cleanDecisionStrings(typography.hierarchy, 8),
            fontDirection: cleanDecisionString(typography.fontDirection),
            spacingDirection: cleanDecisionString(typography.spacingDirection),
            avoid: cleanDecisionStrings(typography.avoid, 8)
        },
        retouch: {
            objectives: cleanDecisionStrings(retouch.objectives, 8),
            colorCorrection: cleanDecisionString(retouch.colorCorrection),
            lighting: cleanDecisionString(retouch.lighting),
            cleanup: cleanDecisionStrings(retouch.cleanup, 8),
            fabricOrMaterialHandling: cleanDecisionString(retouch.fabricOrMaterialHandling),
            prohibitedEdits: cleanDecisionStrings(retouch.prohibitedEdits, 8)
        },
        assetSelection: {
            selectionPrinciples: cleanDecisionStrings(assetSelection.selectionPrinciples, 8),
            requiredInputs: cleanDecisionStrings(assetSelection.requiredInputs, 8),
            rejectRules: cleanDecisionStrings(assetSelection.rejectRules, 8)
        },
        toolWorkflow: normalizeModelDesignWorkflow(record.toolWorkflow),
        acceptanceCriteria: cleanDecisionStrings(record.acceptanceCriteria, 10),
        risks: cleanDecisionStrings(record.risks, 8),
        rationale: cleanDecisionStrings(record.rationale, 8)
    };

    const hasCoreDecision = Boolean(
        decision.designGoal
        && decision.productUnderstanding?.length
        && (decision.hierarchy?.primarySubject || decision.hierarchy?.informationPriority?.length)
        && (decision.color?.paletteIntent || decision.color?.primaryColors?.length)
        && (decision.typography?.tone || decision.typography?.hierarchy?.length)
        && (decision.retouch?.objectives?.length || decision.retouch?.colorCorrection)
        && (decision.assetSelection?.selectionPrinciples?.length || decision.assetSelection?.requiredInputs?.length)
        && decision.toolWorkflow?.length
        && decision.acceptanceCriteria?.length
    );
    return hasCoreDecision ? decision : null;
}

function summarizeDesignPreflightProjectContext(context: AgentContext): string[] {
    const project = context.projectContext;
    const projectContextSummary = buildDesignIntelligenceProjectContextSummary({
        ...project,
        attachmentImageCount: countContextImageInputs(context)
    });
    const assetAvailability = projectContextSummary.assetAvailability;
    const visualUnderstanding = projectContextSummary.visualUnderstanding;
    const productUnderstanding = buildProjectDesignUnderstandingSummary({
        projectContext: project
    });
    return [
        ...(!context.operatingContextSnapshot ? [
            `projectPath=${project?.projectPath || 'unknown'}`,
            `selectedProjectImage=${project?.selectedProjectImageName || project?.selectedProjectImagePath || 'none'}`
        ] : []),
        `availableProjectImages=${assetAvailability.availableImageCount}`,
        `indexedProjectImages=${assetAvailability.indexedImageCount}`,
        `attachedImages=${assetAvailability.attachmentImageCount}`,
        `sampleImages=${(project?.sampleImagePaths || []).slice(0, 5).join(' | ') || 'none'}`,
        `concreteVisualUnderstanding=${visualUnderstanding.concreteInsightCount}`,
        `reportedVisualInsightCount=${visualUnderstanding.reportedInsightCount} (metadata only)`,
        ...productUnderstanding.lines
    ];
}

async function requestModelDesignIntelligenceDecision(
    context: AgentContext,
    input: {
        skillId: string;
        params: Record<string, any>;
        intentSummary?: string;
        routeSource: AgentRequestRouteSource;
    },
    callModel: NonNullable<ProcessOptions['callModel']>
): Promise<DesignIntelligenceAgentDecision | null> {
    const prompt = [
        '你是 DesignEcho 的设计规划 Agent。你只负责在执行 Photoshop 工具前给出公开、结构化、可审计的设计决策。',
        '不要调用工具，不要声称已经读取或修改 Photoshop，不要输出私有推理。',
        '只返回严格 JSON 对象，不要 Markdown。',
        '',
        '必须输出这些字段：',
        '{',
        '  "designGoal": string,',
        '  "productUnderstanding": string[],',
        '  "audience": string,',
        '  "hierarchy": { "primarySubject": string, "focalPoint": string, "informationPriority": string[], "whitespaceIntent": string, "layoutNotes": string[] },',
        '  "color": { "paletteIntent": string, "primaryColors": string[], "accentColors": string[], "backgroundDirection": string, "contrastPlan": string, "avoid": string[] },',
        '  "typography": { "tone": string, "hierarchy": string[], "fontDirection": string, "spacingDirection": string, "avoid": string[] },',
        '  "retouch": { "objectives": string[], "colorCorrection": string, "lighting": string, "cleanup": string[], "fabricOrMaterialHandling": string, "prohibitedEdits": string[] },',
        '  "assetSelection": { "selectionPrinciples": string[], "requiredInputs": string[], "rejectRules": string[] },',
        '  "toolWorkflow": [{ "phase": "inspect|analyze|plan|retouch|compose|export|verify", "goal": string, "allowedToolKinds": string[], "requiredInputs": string[] }],',
        '  "acceptanceCriteria": string[],',
        '  "risks": string[],',
        '  "rationale": string[]',
        '}',
        '',
        '约束：',
        '- 不要输出任何分数字段。',
        '- 不要把知识、偏好或网页信息变成直接 Photoshop 动作。',
        '- 配色、修图、排版和选图都必须说清楚依据和边界。',
        '- 如果视觉观察不足，也要明确 requiredInputs，不要假装已经看过素材。',
        '',
        '当前请求：',
        `userInput=${context.userInput}`,
        `skillId=${input.skillId}`,
        `routeSource=${input.routeSource}`,
        input.intentSummary ? `intentSummary=${input.intentSummary}` : 'intentSummary=none',
        `skillParams=${JSON.stringify(input.params || {})}`,
        '',
        ...(context.operatingContextSnapshot ? [
            '本轮提交情境：',
            compileOperatingContextPrompt(context.operatingContextSnapshot),
            ''
        ] : []),
        '项目上下文：',
        ...summarizeDesignPreflightProjectContext(context)
    ].join('\n');

    try {
        const result = await callModel(
            [
                {
                    role: 'system',
                    content: [
                        buildAgentOperatingProfilePromptSection(),
                        'Return only strict JSON for a public design decision. Do not call tools.'
                    ].join('\n')
                },
                { role: 'user', content: prompt }
            ],
            {
                temperature: 0.2,
                // 设计决策 JSON 含 9 类嵌套字段，1200 tokens 必然截断（截断 → 解析失败 → 执行被拦），
                // 按完整结构所需上调
                maxTokens: 3200,
                purpose: 'design_execution_preflight',
                silent: true,
                stream: false
            }
        );
        return normalizeModelDesignDecisionPayload(parseJsonObjectBlock(String(result?.text || '')));
    } catch (error) {
        console.warn('[DesignAgentEngine] design execution preflight model decision failed:', error);
        return null;
    }
}

const AUTONOMOUS_ROUTING_CONTROL_PARAM_NAMES = Object.freeze([
    'requiresDesignIntelligenceDecision',
    'requiresGenericDesignDecision',
    'designIntelligenceDecision',
    'agentDesignDecision'
]);

function bindAutonomousDeclaredSkillParams(input: {
    skillId?: string;
    params: Record<string, any>;
    deterministicSkillId?: string;
    deterministicParams?: Record<string, any>;
}): Record<string, any> {
    if (!input.skillId) return input.params;
    const businessParams = { ...input.params };
    for (const name of AUTONOMOUS_ROUTING_CONTROL_PARAM_NAMES) {
        delete businessParams[name];
    }
    const sameDeclaredRoute = normalizeSkillId(input.skillId)
        === normalizeSkillId(input.deterministicSkillId);
    return sameDeclaredRoute
        ? { ...businessParams, ...(input.deterministicParams || {}) }
        : businessParams;
}

export function buildAutonomousSkillParams(
    context: AgentContext,
    decision?: Awaited<ReturnType<typeof classifyActionableIntent>>,
    intentControlPlane?: AgentIntentControlPlaneDecision,
    runtimeSelectedSkillHandoff?: RuntimeSelectedSkillHandoff
): Record<string, any> {
    const images = Array.isArray(context.attachedImages) && context.attachedImages.length > 0
        ? toAgentImageAttachments(context.attachedImages)
        : context.attachedImageData
            ? [{ data: context.attachedImageData, mediaType: 'image/jpeg' as const }]
            : undefined;
    const decisionSkillParams = decision?.skillParams && typeof decision.skillParams === 'object'
        ? decision.skillParams
        : {};
    const deterministicHint = fastDeterministicRoute(context.userInput, {
        hasAttachedImage: hasContextImageInput(context),
        intentControlPlane
    });
    const deterministicSkillParams = deterministicHint?.skillParams && typeof deterministicHint.skillParams === 'object'
        ? deterministicHint.skillParams
        : {};
    const decisionIntentSummary = resolveIntentSummary(decision);
    const declaredSkillId = runtimeSelectedSkillHandoff?.skillId || decision?.skillId;
    const routerDeclaredTaskType = decision?.route === 'autonomous_agent' && !declaredSkillId
        ? String(decision.taskTypeId || '').trim()
        : '';
    // R0 模型路由已经给出的结构化业务参数可随 autonomous handoff 继续传递。
    // 这里只读取字段，不从用户文本猜 taskType / workMode。
    const declaredTaskType = routerDeclaredTaskType
        || String(decisionSkillParams.taskType || '').trim();
    const declaredWorkMode = String(decisionSkillParams.workMode || '').trim();
    const governedDecisionSkillParams = bindAutonomousDeclaredSkillParams({
        skillId: declaredSkillId,
        params: decisionSkillParams,
        deterministicSkillId: deterministicHint?.skillId,
        deterministicParams: deterministicSkillParams
    });

    return {
        userTask: context.userInput,
        skillId: decision?.skillId || deterministicHint?.skillId || inferSkillHint(context.userInput),
        // 只有 Planner / 模型路由明确选择的 Skill 才能驱动 Capability manifest。
        // skillId 继续保留 legacy route hint 语义，但 deterministic/text-derived hint 不得伪装成声明。
        ...(declaredSkillId ? { declaredSkillId } : {}),
        // 结构化任务身份必须在 Runtime / CapabilitySession 创建前由 R0 路由传入；循环中的影子声明不切换会话。
        ...(declaredTaskType ? { declaredTaskType } : {}),
        ...(declaredWorkMode ? { declaredWorkMode } : {}),
        ...(runtimeSelectedSkillHandoff ? { runtimeSelectedSkillHandoff } : {}),
        skillParams: Object.keys(governedDecisionSkillParams).length > 0
            ? governedDecisionSkillParams
            : deterministicSkillParams,
        intentMode: decision?.mode,
        ...(intentControlPlane ? { agentIntentControlPlane: intentControlPlane } : {}),
        ...(context.providerNativeWebSearchIntent ? { providerNativeWebSearchIntent: context.providerNativeWebSearchIntent } : {}),
        ...(decisionIntentSummary ? { recognizedIntent: decisionIntentSummary } : {}),
        images,
        ...(context.projectContext?.projectPath ? { projectPath: context.projectContext.projectPath } : {})
    };
}

/**
 * 模型已选业务 Skill、但 Skill 声明禁止直接执行时，只保留 R0 选择事实交给 autonomous runtime。
 * 不保留“直接执行”授权，也不从任务文本或 deterministic hint 补造选择。
 */
export function buildModelSelectedSkillRuntimeHandoff(
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>,
    intentControlPlane?: Pick<AgentIntentControlPlaneDecision, 'requestKind' | 'allowsAutonomousExecution'>
): RuntimeSelectedSkillHandoff | undefined {
    if (intentControlPlane?.requestKind !== 'autonomous_execution'
        || intentControlPlane.allowsAutonomousExecution !== true) return undefined;
    if (decision?.route !== 'skill_execution') return undefined;
    const skillId = normalizeSkillId(decision.skillId);
    if (!skillId) return undefined;
    const skill = getSkillById(skillId);
    if (!skill) return undefined;
    return buildRuntimeSelectedSkillHandoff({
        skillId,
        routeClass: skill.routeClass,
        directExecution: skill.modelDirectExecution
    });
}

/**
 * R0 能力归属收口：模型已经明确选择 business Skill 时优先保留模型选择；当 router
 * 无结果或选择通用 autonomous_agent 时，仅允许“唯一命中”的 Skill declaration
 * 提供结构化归属。声明匹配不执行工作流、不授予工具权限，多个候选继续保持通用发现。
 */
export function buildRuntimeSelectedSkillHandoffForExecution(
    userInput: string,
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>,
    intentControlPlane?: Pick<AgentIntentControlPlaneDecision, 'requestKind' | 'allowsAutonomousExecution'>
): RuntimeSelectedSkillHandoff | undefined {
    const modelSelected = buildModelSelectedSkillRuntimeHandoff(decision, intentControlPlane);
    if (modelSelected) return modelSelected;
    if (intentControlPlane?.requestKind !== 'autonomous_execution'
        || intentControlPlane.allowsAutonomousExecution !== true) return undefined;
    if (decision && decision.route !== 'autonomous_agent') return undefined;

    const declaredMatch = findUniqueSkillRoutingIntent(userInput, {
        includeVisibilities: ['user-facing'],
        includeRouteClasses: ['business-workflow'],
        modelDirectExecution: 'forbidden'
    });
    if (!declaredMatch) return undefined;

    const skill = getSkillById(declaredMatch.skillId);
    if (!skill) return undefined;
    return buildRuntimeSelectedSkillHandoff({
        skillId: skill.id,
        source: 'skill_declaration_unique_match',
        routeClass: skill.routeClass,
        directExecution: skill.modelDirectExecution
    });
}

/**
 * 受控确定性路由被转入 ReAct 时保留其结构化 Skill 身份。
 * 该来源只记录 R0 已选择的能力，不执行 Skill，也不授予工具权限。
 */
export function buildControlledRouteSelectedSkillRuntimeHandoff(
    skillId: string | undefined,
    intentControlPlane?: AgentIntentControlPlaneDecision
): RuntimeSelectedSkillHandoff | undefined {
    if (!skillId || !intentControlPlane) {
        return undefined;
    }
    const normalizedSkillId = normalizeSkillId(skillId);
    if (!normalizedSkillId || !isControlledRouteAutonomousEntrySkill(normalizedSkillId)) {
        return undefined;
    }
    if (!shouldEnterAutonomousReActForControlledRoute(skillId, intentControlPlane)) {
        return undefined;
    }
    const skill = getSkillById(normalizedSkillId);
    if (!skill) return undefined;
    return buildRuntimeSelectedSkillHandoff({
        skillId: skill.id,
        source: 'controlled_route_react_handoff',
        routeClass: skill.routeClass,
        directExecution: skill.modelDirectExecution
    });
}

function hasContextImageInput(context: AgentContext): boolean {
    return Boolean(context.hasAttachedImage)
        || Boolean(context.attachedImageData)
        || (Array.isArray(context.attachedImages) && context.attachedImages.length > 0);
}

function countContextImageInputs(context: AgentContext): number {
    const structuredImageCount = Array.isArray(context.attachedImages)
        ? context.attachedImages.length
        : 0;
    return Math.max(structuredImageCount, hasContextImageInput(context) ? 1 : 0);
}

function buildRetryDeterministicRoute(context: AgentContext) {
    if (!isRetryFeedbackIntent(context.userInput)) return null;

    const history = Array.isArray(context.conversationHistory) ? context.conversationHistory : [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const item = history[index];
        if (item?.role !== 'user') continue;
        const previousInput = String(item?.content || '').trim();
        if (!previousInput || isRetryFeedbackIntent(previousInput)) continue;

        const previousRoute = fastDeterministicRoute(previousInput);
        if (!previousRoute || previousRoute.skillId === 'agent-panel-bridge') continue;

        return {
            ...previousRoute,
            skillParams: {
                ...previousRoute.skillParams,
                retry: true,
                retryFeedback: context.userInput,
                previousUserIntent: previousInput
            },
            thinking: '复核上一条任务结果并重新执行。'
        };
    }

    return null;
}

function buildReadOnlyInspectFallbackRoute(
    context: AgentContext,
    intentControlPlane: AgentIntentControlPlaneDecision
): ReturnType<typeof fastDeterministicRoute> {
    if (intentControlPlane.requestKind !== 'read_only_inspect') return null;
    const sourceType = hasContextImageInput(context) ? 'attached_image' : 'active_document';
    return {
        skillId: 'visual-analysis',
        skillParams: {
            sourceType,
            analysisFocus: 'general',
            userIntent: context.userInput
        },
        thinking: sourceType === 'attached_image'
            ? '读取用户本轮上传的图片并做只读视觉分析。'
            : '读取当前画面快照并做只读视觉检查。'
    };
}

/**
 * 用户显式点名多智能体协作（团队流水线/多角色评审）时，确定性单技能路由必须让位：
 * runDesignTeamPipeline 与 delegateToAgent 只存在于自主循环的工具集里，
 * deterministic 短路到单技能会把用户点名的协作模式整个吃掉（实测：
 * 「用设计团队流水线评审详情页」被路由进 detail-page-design inspect）。
 * 这是显式指令保护，与 explicit_no_tool_directive 同性质，不是意图猜测。
 * 判定本体已收敛到 shared/agent-intent-control-plane 的 hasExplicitTeamPipelineIntent（单一来源），
 * 此处不再维护重复正则。
 */

/**
 * 执行点约束：意图控制面只授权只读（read_only）时，确定性路由不得直接执行写类技能。
 * 例：「看一下详情页文档有几屏」关键词会命中 detail-page-design（制作详情页的写类工作流），
 * 但用户要的是查看而不是制作——此时跳过该确定性候选，交给只读回退或自主循环。
 * 技能读写分类复用 shared/agent-tool-execution-preflight，不在引擎里另建技能名单。
 */
function isDeterministicRouteCompatibleWithToolScope(
    route: ReturnType<typeof fastDeterministicRoute>,
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    if (!route) return false;
    if (
        route.skillId === 'document-management'
        && intentControlPlane.requestKind === 'autonomous_execution'
        && intentControlPlane.matchedSignals?.includes('explicit_creative_design') === true
    ) {
        return false;
    }
    if (intentControlPlane.toolScope !== 'read_only') return true;
    const kind = classifyAgentToolExecution(route.skillId, route.skillParams);
    return kind === 'read_only_observation' || kind === 'knowledge_search';
}

function isModelSkillExecutionCompatibleWithIntentBoundary(
    context: AgentContext,
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>,
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    if (decision?.route !== 'skill_execution') return true;
    const skillId = normalizeSkillId(decision.skillId);
    if (!skillId) return true;
    if (skillId === 'main-image-template-authoring' || skillId === 'detail-page-template-authoring') {
        return false;
    }
    // 声明为 modelDirectExecution: 'forbidden' 的技能必须通过自主执行循环执行，不能由模型路由直接执行。
    // 这些技能需要 Agent 的 ReAct 循环来理解上下文、处理错误、逐步推进。
    // 单一来源：SkillDeclaration（skill-declarations.ts），不再在引擎里硬编码 skillId Set。
    if (isModelDirectExecutionForbiddenSkill(skillId)) return false;
    return true;
}

function canExecuteSkillFromUserRequest(skillId: string, userInput: string): boolean {
    const skill = getSkillById(skillId);
    if (!skill) return false;
    if (skill.visibility === 'system-only') return false;
    if (skill.visibility === 'internal-debug') {
        return isAgentPanelDebugIntent(userInput);
    }
    return true;
}

function shouldExecuteDeterministicRouteBeforeRouterModel(
    deterministicRoute: ReturnType<typeof fastDeterministicRoute>,
    input: {
        hasVisibleModelReasoning: boolean;
        hasContextImage: boolean;
        userInputText?: string;
    }
): boolean {
    return evaluateSimpleDeterministicRouteBoundary({
        skillId: deterministicRoute?.skillId,
        hasVisibleModelReasoning: input.hasVisibleModelReasoning,
        hasContextImage: input.hasContextImage,
        userInputText: input.userInputText
    }).allowed;
}

function shouldRequestInitialVisibleIntentPreview(
    initialDeterministicRoute: ReturnType<typeof fastDeterministicRoute>,
    input: {
        intentControlPlane: AgentIntentControlPlaneDecision;
        hasContextImage: boolean;
        userInputText?: string;
    }
): boolean {
    void initialDeterministicRoute;
    void input;
    return false;
}

function buildSkillParamsFromModelDecision(
    context: AgentContext,
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>
): Record<string, any> {
    if (!decision?.skillId) return {};
    const decisionParams = decision.skillParams && typeof decision.skillParams === 'object'
        ? decision.skillParams
        : {};
    const params = applySharedSkillParamDefaults({
        skillId: decision.skillId,
        userInput: context.userInput,
        mode: decision.mode,
        params: decisionParams
    });
    // 模型只选择「视觉分析」但没有明确数据源时，真实附件优先于 Photoshop 当前画布。
    // 这只解决输入对象归属，不替模型猜任务品类，也不覆盖模型显式指定的图层/文件/画布来源。
    if (
        normalizeSkillId(decision.skillId) === 'visual-analysis'
        && hasContextImageInput(context)
        && !Object.prototype.hasOwnProperty.call(decisionParams, 'sourceType')
    ) {
        return { ...params, sourceType: 'attached_image' };
    }
    return params;
}

/**
 * 路由边界策略需要的 7 个意图信号，单一构造点：
 * shouldDeterministicRouteVetoModelSkill 与 evaluateDeterministicNonExecutionProtectionForContext
 * 曾各自内联同一组谓词调用（重复定义），收敛为本函数（谓词本体仍在 agent-orchestration/routing.ts，
 * 只作提示/边界输入，不拦截模型——v3 原则）。谓词均为纯函数且开销为正则级，未做跨调用缓存。
 */
function buildRouteBoundaryIntentSignals(context: AgentContext): {
    isSkuIntent: boolean;
    isMainImageDesignIntent: boolean;
    isDocumentManagementIntent: boolean;
    isLayoutReplicationIntent: boolean;
    isDetailTemplateAuthoringIntent: boolean;
    isMainImageTemplateAuthoringIntent: boolean;
    isTemplateSaveIntent: boolean;
} {
    return {
        isSkuIntent: isSkuIntent(context.userInput),
        isMainImageDesignIntent: isMainImageDesignIntent(context.userInput),
        isDocumentManagementIntent: isDocumentManagementIntent(context.userInput),
        isLayoutReplicationIntent: isLayoutReplicationIntent(context.userInput, { hasAttachedImage: hasContextImageInput(context) }),
        isDetailTemplateAuthoringIntent: isDetailTemplateAuthoringIntent(context.userInput),
        isMainImageTemplateAuthoringIntent: isMainImageTemplateAuthoringIntent(context.userInput),
        isTemplateSaveIntent: isTemplateSaveIntent(context.userInput)
    };
}

function shouldDeterministicRouteVetoModelSkill(
    context: AgentContext,
    deterministicRoute: ReturnType<typeof fastDeterministicRoute>,
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>
): RouteBoundaryDecision {
    if (!deterministicRoute?.skillId || !decision?.skillId) {
        return {
            version: 'agent-route-boundary-policy/v0',
            allowed: false,
            category: 'not_applicable',
            reason: '缺少确定性路由或模型路由结果。'
        };
    }

    const deterministicSkillId = deterministicRoute.skillId;
    const modelSkillId = normalizeSkillId(decision.skillId);
    return evaluateDeterministicRouteVeto({
        deterministicSkillId,
        modelSkillId,
        isRetryRoute: deterministicRoute.skillParams?.retry === true,
        ...buildRouteBoundaryIntentSignals(context)
    });
}

function userRequestedClarificationBeforeExecution(text: string): boolean {
    return /(?:如果|要是|若|假如).{0,16}(?:信息|素材|条件|文件|资料|上下文).{0,16}(?:不够|不足|缺少|不完整).{0,16}(?:先|再)?(?:问|确认|告诉)/i.test(text)
        || /(?:信息|素材|条件|文件|资料|上下文).{0,16}(?:不够|不足|缺少|不完整).{0,16}(?:先|再)?(?:问我|确认)/i.test(text)
        || /(?:不够|缺少).{0,12}(?:先问我|先确认)/i.test(text);
}

function shouldBypassRouterNonExecutionForConfirmedAutonomousTask(
    intentControlPlane: AgentIntentControlPlaneDecision,
    modelDecision: Awaited<ReturnType<typeof classifyActionableIntent>>
): boolean {
    const modelRoute = String(modelDecision?.route || '');
    if (!['direct_response', 'clarification_needed'].includes(modelRoute)) return false;
    return intentControlPlane.requestKind === 'autonomous_execution'
        && intentControlPlane.executionAuthorization === 'confirmed_tool_required';
}

function hasConfirmedToolExecutionAuthorization(
    intentControlPlane?: AgentIntentControlPlaneDecision
): boolean {
    return intentControlPlane?.executionAuthorization === 'confirmed_tool_required';
}

function isConfirmedAutonomousTask(
    intentControlPlane?: AgentIntentControlPlaneDecision,
    skillId?: string
): boolean {
    return skillId === 'autonomous-agent'
        && intentControlPlane?.requestKind === 'autonomous_execution'
        && hasConfirmedToolExecutionAuthorization(intentControlPlane);
}

function isExplicitProjectContextAutonomousDeliveryFallback(
    context: AgentContext,
    agentTaskPlan: AgentTaskPlanningContract,
    skillId?: string
): boolean {
    const approval = context.agentTaskPublicPlanApproval;
    const text = String(context.userInput || '');
    const hasProjectMaterialIntent = /(?:当前项目|这个项目|本项目|项目).{0,32}(?:图片|素材|资源|照片)|使用当前项目/u.test(text);
    const hasDeliveryIntent = /(?:完成|交付|产出|创建|生成|制作|设计|导出|保存|可验收).{0,48}(?:主图|详情页|长图|海报|banner|视觉|设计稿)|(?:主图|详情页|长图|海报|banner|视觉|设计稿).{0,48}(?:完成|交付|产出|创建|生成|制作|设计|导出|保存|可验收)/iu.test(text);
    return skillId === 'autonomous-agent'
        && agentTaskPlan.status === 'ready_for_model_planning'
        && agentTaskPlan.requestKind === 'autonomous_execution'
        && approval?.approveGeneratedPublicPlan === true
        && approval.userConfirmed === true
        && approval.allowPhotoshopWrites === true
        && approval.liveExecutionScope === 'disposable-document'
        && Boolean(context.projectContext?.projectPath)
        && hasProjectMaterialIntent
        && hasDeliveryIntent;
}

export function buildAutonomousRuntimeDecisionForAgentChoice(
    source: AgentIntentControlPlaneDecision,
    reason: string,
    modelDecision?: {
        route?: string;
        mode?: string;
        taskTypeId?: string;
        skillId?: string;
    } | null
): AgentIntentControlPlaneDecision {
    const decision = buildAutonomousExecutionDecisionForEngine(reason, source);
    // 本地控制面把“当前文档”一类对象信号保守归为只读时，不能继续否决 R0 模型已经给出的
    // 结构化设计执行声明。这里不增加动作关键词：仅当模型选择 autonomous_agent + execute、
    // 没有伪造 Skill，且 taskTypeId 来自共享任务目录时，将这类 read_only 假阴性纠正为写入范围。
    // candidate_only / none 不升级；最终写入仍经过 Tool Decision、Preflight 与读回门禁。
    const structuredDesignWrite = source.requestKind === 'read_only_inspect'
        && source.toolScope === 'read_only'
        && modelDecision?.route === 'autonomous_agent'
        && modelDecision.mode === 'execute'
        && !String(modelDecision.skillId || '').trim()
        && isRegisteredDesignTaskTypeId(modelDecision.taskTypeId);
    return {
        ...decision,
        // Model 选择 autonomous_agent 只决定运行载体，不能把 candidate_only 静默升级为
        // confirmed_tool_required。是否直进循环由控制面的授权状态决定，而不是品类信号。
        executionAuthorization: source.executionAuthorization,
        toolScope: structuredDesignWrite ? 'write_photoshop' : source.toolScope
    };
}

function evaluateDeterministicNonExecutionProtectionForContext(
    context: AgentContext,
    deterministicRoute: ReturnType<typeof fastDeterministicRoute>,
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>,
    intentControlPlane: AgentIntentControlPlaneDecision
): RouteBoundaryDecision {
    return evaluateDeterministicNonExecutionProtection({
        deterministicSkillId: deterministicRoute?.skillId,
        requestKind: intentControlPlane.requestKind,
        executionAuthorization: intentControlPlane.executionAuthorization,
        modelRoute: decision?.route,
        modelDirectResponse: decision?.directResponse,
        modelClarificationQuestion: decision?.clarificationQuestion,
        isRetryRoute: deterministicRoute?.skillParams?.retry === true,
        ...buildRouteBoundaryIntentSignals(context),
        userRequestedClarification: userRequestedClarificationBeforeExecution(context.userInput)
    });
}

function buildSkillUnavailableResult(skillId: string, userInput: string): AgentResult | null {
    const publicUnavailableMessage =
        getInternalAgentStatusPublicMessage('skill executor not found')
        || '这个操作暂时还不能直接完成；本轮不会改动画面。';
    if (!canExecuteSkillFromUserRequest(skillId, userInput)) {
        return {
            success: false,
            message: publicUnavailableMessage,
            error: 'Skill not user-invocable'
        };
    }
    if (!isSkillEnabled(skillId)) {
        return {
            success: false,
            message: getInternalAgentStatusPublicMessage('skill disabled') || publicUnavailableMessage,
            error: 'Skill disabled'
        };
    }
    if (!getSkillExecutor(skillId)) {
        return {
            success: false,
            message: publicUnavailableMessage,
            error: 'Skill executor not found'
        };
    }
    return null;
}

function isCompletedPublicPlanControlledRun(run: AgentTaskPublicPlanControlledRun): boolean {
    return run.status === 'completed_live_adapter_verified'
        || run.status === 'completed_fake_adapter_verified'
        || run.status === 'completed_dry_run';
}

const NON_RECOVERABLE_PUBLIC_PLAN_CONTROLLED_RUN_STATUSES = new Set([
    'blocked_request_not_ready',
    'blocked_adapter_required',
    'blocked_live_write_permission_missing',
    'blocked_live_execution_scope_required',
    'blocked_live_project_write_approval_required',
    'blocked_live_adapter_required',
    'blocked_readback_adapter_required'
]);

function shouldRecoverFromPublicPlanControlledRunFailure(run: AgentTaskPublicPlanControlledRun): boolean {
    if (isCompletedPublicPlanControlledRun(run)) return false;
    return !NON_RECOVERABLE_PUBLIC_PLAN_CONTROLLED_RUN_STATUSES.has(run.status);
}

/**
 * 确认范围内处理失败后，构造包含失败信息的恢复 task，传给 Agent ReAct + Reflexion。
 * Agent 在 ReAct 循环中观察失败、决定换路（检查 PS 连接、调整参数、换用替代方案）；
 * Agent 失败后走 Reflexion 回路（上一轮实现的 while 循环）。
 */
function buildControlledRunFailureRecoveryTask(
    approvalRecord: ReturnType<typeof buildAgentTaskPublicPlanApprovalRecord>,
    controlledRun: AgentTaskPublicPlanControlledRun,
    scopeContext?: {
        liveExecutionScope?: unknown;
        explicitProjectWriteApproval?: unknown;
    }
): string {
    const originalGoal = approvalRecord.agentTaskPlan?.designBrief?.goal
        || approvalRecord.agentTaskPublicPlan?.message
        || '';
    const planSummary = controlledRun.executionPlanSummary
        || controlledRun.publicPlanSummary
        || approvalRecord.agentTaskPublicPlan?.executionPlanSummary
        || '';
    const succeededOps = controlledRun.operationResults
        .filter((r) => r.success)
        .map((r) => r.toolName);
    const failedOps = controlledRun.operationResults
        .filter((r) => !r.success)
        .map((r) => `${r.toolName}（${r.error || '未知错误'}）`);

    // 保留原确认范围的执行边界约束，防止 Agent 在恢复时超出用户已批准的范围
    const scopeConstraints: string[] = [];
    const allowedWriteTools = approvalRecord.allowedWriteTools;
    if (Array.isArray(allowedWriteTools) && allowedWriteTools.length > 0) {
        scopeConstraints.push(`本次恢复仅允许使用以下写入工具：${allowedWriteTools.join('、')}。不要使用超出此范围的写入操作。`);
    }
    const liveExecutionScope = scopeContext?.liveExecutionScope;
    if (liveExecutionScope && typeof liveExecutionScope === 'object') {
        const scopeParts = Object.entries(liveExecutionScope)
            .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join('/') : String(value)}`)
            .filter(Boolean);
        if (scopeParts.length > 0) {
            scopeConstraints.push(`执行范围约束：${scopeParts.join('；')}。`);
        }
    }

    return [
        originalGoal || '执行已确认的设计方案',
        '',
        '【确认范围内处理失败，转入 Agent 自主恢复】',
        planSummary ? `已确认的计划：${planSummary}` : '',
        succeededOps.length ? `已成功完成的操作：${succeededOps.join('、')}（不要重复执行）` : '',
        failedOps.length ? `失败的操作：\n${failedOps.map((op) => `- ${op}`).join('\n')}` : '',
        controlledRun.blockers.length ? `失败原因：${controlledRun.blockers.join('；')}` : '',
        scopeConstraints.length ? `\n执行边界约束（必须遵守）：\n${scopeConstraints.map((s) => `- ${s}`).join('\n')}` : '',
        '',
        '请在失败的操作上换路重试：检查 Photoshop 连接状态、调整工具参数或换用替代方案。',
        '不要重新规划整个任务，已成功的操作不要重复执行。'
    ].filter(Boolean).join('\n');
}

function formatReadableList(items: string[], fallback = '画面内容'): string {
    const cleaned = items.map((item) => String(item || '').trim()).filter(Boolean);
    if (cleaned.length === 0) return fallback;
    if (cleaned.length === 1) return cleaned[0];
    return `${cleaned.slice(0, -1).join('、')}和${cleaned[cleaned.length - 1]}`;
}

function summarizeReadbackTargetsForUser(targets: string[]): string[] {
    const output: string[] = [];
    const joined = targets.join(' ');
    if (/layer_hierarchy|layer_properties|document_info/i.test(joined)) {
        output.push('可编辑图层');
    }
    if (/acceptance_snapshot|document_snapshot|annotated_snapshot/i.test(joined)) {
        output.push('画面内容');
    }
    if (output.length === 0 && targets.length > 0) {
        output.push('画面内容');
    }
    return Array.from(new Set(output));
}

function summarizeBlocksForUser(blocks: any[]): string {
    const title = blocks.find((block) => block?.role === 'title' && block.content)?.content;
    const sellingPoints = blocks
        .filter((block) => block?.role === 'selling-point' && block.content)
        .map((block) => String(block.content).trim())
        .filter(Boolean);
    const parts = ['版面'];
    if (blocks.some((block) => block?.role === 'background')) parts.push('背景');
    if (title) parts.push(`标题“${sanitizeAgentTaskPublicPlanDisplayText(title, 60)}”`);
    if (sellingPoints.length > 0) parts.push(`${sellingPoints.length} 个卖点色块`);
    return parts.join('、');
}

function summarizeOperationForUser(operation: AgentTaskPublicPlanControlledOperationRequest): string {
    const params = operation.params && typeof operation.params === 'object'
        ? operation.params as Record<string, any>
        : {};
    if (operation.toolName === 'createDocument') {
        const width = Number(params.width);
        const height = Number(params.height);
        const size = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
            ? `${Math.round(width)}x${Math.round(height)}`
            : '';
        return size ? `${size} 临时画布` : '临时画布';
    }
    if (operation.toolName === 'renderLayout') {
        const blocks = Array.isArray(params.blocks) ? params.blocks : [];
        return blocks.length > 0 ? summarizeBlocksForUser(blocks) : '版面内容';
    }
    if (operation.toolName === 'placeImage') {
        return '项目图片';
    }
    if (operation.toolName === 'saveDocument') {
        return '导出文件';
    }
    if (operation.toolName === 'createTextLayer' || operation.toolName === 'setTextContent') {
        const content = sanitizeAgentTaskPublicPlanDisplayText(params.content || params.text, 60);
        return content ? `可编辑文字“${content}”` : '可编辑文字';
    }
    if (operation.toolName === 'createRectangle' || operation.toolName === 'createEllipse') {
        return '简单色块';
    }
    return sanitizeAgentTaskPublicPlanDisplayText(operation.paramsSummary, 80) || '一项画面调整';
}

function summarizeDesignDecisionFromOperations(run: AgentTaskPublicPlanControlledRun): string {
    const renderOperation = run.operationRequests.find((operation) => operation.toolName === 'renderLayout');
    const params = renderOperation?.params && typeof renderOperation.params === 'object'
        ? renderOperation.params as Record<string, any>
        : {};
    const blocks = Array.isArray(params.blocks) ? params.blocks : [];
    const title = blocks.find((block) => block?.role === 'title' && block.content)?.content;
    const sellingPoints = blocks
        .filter((block) => block?.role === 'selling-point' && block.content)
        .map((block) => String(block.content).trim())
        .filter(Boolean);
    if (title && sellingPoints.length > 0) {
        return `用标题“${sanitizePublicPlanUserFacingText(title, 60)}”先明确主题，再用 ${sellingPoints.length} 个卖点模块承接购买理由。`;
    }
    if (title) {
        return `先用标题“${sanitizePublicPlanUserFacingText(title, 60)}”建立首屏主题，再保留后续版面调整空间。`;
    }
    if (sellingPoints.length > 0) {
        return `先用 ${sellingPoints.length} 个卖点模块搭出基础购买理由，再继续补充图片和细节。`;
    }
    return '';
}

function summarizeControlledRunDesignDecisionForUser(run: AgentTaskPublicPlanControlledRun): string {
    const rawDecision = sanitizePublicPlanUserFacingText(run.publicPlanSummary, 220)
        .replace(/^公开设计计划[：:]\s*/u, '')
        .replace(/；?等待用户确认后才允许(?:受控)?执行。?$/u, '')
        .replace(/；?确认后(?:才)?(?:允许|开始)(?:受控)?执行。?$/u, '')
        .trim();
    if (!rawDecision) return summarizeDesignDecisionFromOperations(run);
    if (rawDecision.length > 120 || /计划分[一二三四五六七八九十\d]?步/u.test(rawDecision)) {
        return summarizeDesignDecisionFromOperations(run) || rawDecision;
    }
    return rawDecision;
}

function summarizeControlledRunExecutionIdeaForUser(run: AgentTaskPublicPlanControlledRun): string {
    const explicitSummary = sanitizePublicPlanUserFacingText(run.executionPlanSummary, 220);
    if (explicitSummary) return explicitSummary;
    const operationSummaries = run.operationRequests
        .map((operation) => sanitizePublicPlanUserFacingText(operation.paramsSummary, 120))
        .filter(Boolean);
    return operationSummaries[0] || '';
}

function summarizeObservationDiffForUser(run: AgentTaskPublicPlanControlledRun): string {
    const diff = run.observationDiff;
    if (!diff || diff.status !== 'mismatch') return '';
    const summary = sanitizePublicPlanUserFacingText(diff.userVisibleSummary, 180);
    const missingCopy = diff.missingVisibleCopy
        .map((item) => sanitizePublicPlanUserFacingText(item, 40))
        .filter(Boolean)
        .slice(0, 4);
    if (summary) return summary;
    if (missingCopy.length > 0) {
        return `画面里暂时没有看到「${missingCopy.join('」「')}」。`;
    }
    return '真实画面和原计划不一致，需要继续观察或调整。';
}

function emitControlledRunVisibleReview(
    callbacks: ProcessOptions['callbacks'],
    run: AgentTaskPublicPlanControlledRun
): void {
    const observationDiff = summarizeObservationDiffForUser(run);
    const completed = isCompletedPublicPlanControlledRun(run);
    const blocker = sanitizePublicPlanUserFacingText(run.blockers.find(Boolean), 180);
    const detail = observationDiff
        ? `${observationDiff} 下一步应先修正这处差异，或确认这是用户主动删改后的新目标。`
        : completed
            ? '我已经看过真实画面，计划中的主要内容仍然存在，可以继续进入下一步人工审美确认。'
            : blocker || '真实画面还没有达到计划状态，需要继续补齐条件后再处理。';

    callbacks?.onStep?.({
        kind: 'verification',
        title: observationDiff ? '复核真实画面' : '复核画面结果',
        detail,
        status: completed ? 'success' : 'error',
        percent: completed ? 100 : 82
    });
}

function formatPublicPlanControlledRunMessage(run: AgentTaskPublicPlanControlledRun): string {
    const completedOperations = run.operationRequests
        .filter((operation) => (
            run.operationResults.length === 0
            || run.operationResults.some((result) => result.operationId === operation.operationId && result.success)
        ))
        .map(summarizeOperationForUser);
    const reviewTargets = summarizeReadbackTargetsForUser(run.readbackTargets);
    const designDecision = summarizeControlledRunDesignDecisionForUser(run);
    const executionIdea = summarizeControlledRunExecutionIdeaForUser(run);
    const observationDiff = summarizeObservationDiffForUser(run);
    if (run.status === 'completed_live_adapter_verified') {
        return [
            designDecision ? `我的设计方案判断：${designDecision}` : '已按确认的设计方案创建好临时画面。',
            executionIdea ? `这次先做：${executionIdea}` : '',
            `已完成：${formatReadableList(completedOperations, '临时画面')}。`,
            `已复核：${formatReadableList(reviewTargets, '画面内容')}。`,
            '建议再看一下整体留白、对齐和文字大小，确认视觉效果是否符合预期。'
        ].filter(Boolean).join('\n');
    }
    if (run.status === 'completed_fake_adapter_verified' || run.status === 'completed_dry_run') {
        return [
            designDecision ? `我的设计方案判断：${designDecision}` : '这份设计方案已经检查过，本轮没有改动画面。',
            executionIdea ? `这次会先做：${executionIdea}` : '',
            '需要落地时，我会先创建临时画布，再生成可编辑的文字和色块。'
        ].filter(Boolean).join('\n');
    }

    if (run.status === 'failed_readback' && observationDiff) {
        return [
            designDecision ? `我的设计方案判断：${designDecision}` : '我已经按方案做了当前阶段画面。',
            executionIdea ? `原计划：${executionIdea}` : '',
            `我复核后看到：${observationDiff}`,
            '这还不是最终完成状态。下一步应该把这次观察差异交回 Agent，继续补齐画面并再次复核。'
        ].filter(Boolean).join('\n');
    }

    return [
        designDecision ? `我的设计方案判断：${designDecision}` : '已确认设计方案，但这次没有改动画面。',
        executionIdea ? `原计划：${executionIdea}` : '',
        '画面创建过程中有一步没有完成，需要补齐可直接创建画面的条件后再继续。'
    ].filter(Boolean).join('\n');
}

function shouldRepairAfterControlledRunObservation(run: AgentTaskPublicPlanControlledRun): boolean {
    return run.status === 'failed_readback'
        && run.observationDiff?.status === 'mismatch'
        && ['repair_missing_visible_copy', 'observe_again'].includes(run.observationDiff.nextAction);
}

function buildControlledRunRepairTaskText(input: {
    context: AgentContext;
    run: AgentTaskPublicPlanControlledRun;
}): string {
    const diff = input.run.observationDiff;
    const missingCopy = (diff?.missingVisibleCopy || [])
        .map((item) => sanitizePublicPlanUserFacingText(item, 50))
        .filter(Boolean)
        .slice(0, 8);
    const observedCopy = (diff?.observedVisibleCopy || [])
        .map((item) => sanitizePublicPlanUserFacingText(item, 50))
        .filter(Boolean)
        .slice(0, 8);
    const summary = sanitizePublicPlanUserFacingText(diff?.userVisibleSummary, 220);

    // 保留原确认范围的执行边界约束，与 buildControlledRunFailureRecoveryTask 保持一致
    const scopeConstraints: string[] = [];
    const approval = input.context.agentTaskPublicPlanApproval;
    if (approval?.allowedWriteTools && Array.isArray(approval.allowedWriteTools) && approval.allowedWriteTools.length > 0) {
        scopeConstraints.push(`本次修复仅允许使用以下写入工具：${approval.allowedWriteTools.join('、')}。不要使用超出此范围的写入操作。`);
    }

    return [
        '继续当前设计任务。真实画面复核发现上一轮结果还没有完成，请不要询问用户确认，先自己继续修复。',
        input.context.userInput ? `原始任务：${input.context.userInput}` : '',
        summary ? `真实画面复核发现：${summary}` : '',
        missingCopy.length > 0 ? `需要补齐的画面内容：${missingCopy.join('、')}` : '',
        observedCopy.length > 0 ? `已经观察到的画面内容：${observedCopy.join('、')}` : '',
        scopeConstraints.length ? `\n执行边界约束（必须遵守）：\n${scopeConstraints.map((s) => `- ${s}`).join('\n')}` : '',
        '下一步：先观察或读取当前 Photoshop 画面，判断缺失内容应该补回、重排还是重新生成当前阶段；修复后必须再次观察真实画面，再决定是否继续。'
    ].filter(Boolean).join('\n');
}

function buildPublicPlanControlledRunResult(input: {
    approvalRecord: unknown;
    executionRequest: unknown;
    controlledRun: AgentTaskPublicPlanControlledRun;
}): AgentResult {
    const completed = isCompletedPublicPlanControlledRun(input.controlledRun);
    const agentReActObservation = buildAgentReActObservationFromPublicPlanRun(input.controlledRun);
    const result: AgentResult = {
        success: completed,
        message: formatPublicPlanControlledRunMessage(input.controlledRun),
        error: completed ? undefined : input.controlledRun.status,
        data: {
            agentTaskPublicPlanApprovalRecord: input.approvalRecord,
            agentTaskPublicPlanExecutionRequest: input.executionRequest,
            agentTaskPublicPlanControlledRun: input.controlledRun,
            agentReActObservation
        }
    };
    return withAssistantReplyOrigin(
        result,
        completed
            ? toolSummaryReplyOrigin('public-plan-controlled-run')
            : deterministicBlockerReplyOrigin(`public-plan-controlled-run:${input.controlledRun.status}`)
    );
}

const GENERIC_DESIGN_EXECUTION_MODES = new Set(['creative-design', 'open-design', 'redesign']);
// 「模型路由不得直执」的技能名单已收敛为声明单一来源：
// SkillDeclaration.modelDirectExecution === 'forbidden'（isModelDirectExecutionForbiddenSkill 派生），
// 不再在此维护硬编码 Set（原 CREATIVE_DRAFT_CONTROLLED_SKILL_DENYLIST，7 技能，
// 等价性由 scripts/smoke-skill-route-guard-declaration.cjs 钉桩）。

function isGenericDesignExecutionMode(value?: unknown): boolean {
    const normalized = String(value || '').trim().toLowerCase();
    return GENERIC_DESIGN_EXECUTION_MODES.has(normalized);
}

function isControlledSkuExecutionRequest(context: AgentContext, skillId?: string): boolean {
    return normalizeSkillId(skillId) === 'sku-batch' && isSkuIntent(context.userInput);
}

function isExplicitDelegatedGoalOwnedByAgent(
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    return intentControlPlane.requestKind === 'autonomous_execution'
        && intentControlPlane.executionAuthorization !== 'none'
        && intentControlPlane.toolScope !== 'none'
        && intentControlPlane.matchedSignals?.includes('explicit_task_delegation') === true;
}

// 受控工作流是否应进入 ReAct 循环由 SkillDeclaration.controlledRouteEntry 单一声明派生。
// routeClass 只描述能力类别，不能替代运行入口契约。
function shouldEnterAutonomousReActForControlledRoute(
    skillId: string | undefined,
    intentControlPlane: AgentIntentControlPlaneDecision
): boolean {
    return intentControlPlane.executionAuthorization !== 'none'
        && intentControlPlane.toolScope !== 'none'
        && Boolean(skillId)
        && (
            isExplicitDelegatedGoalOwnedByAgent(intentControlPlane)
            || isControlledRouteAutonomousEntrySkill(normalizeSkillId(skillId) || String(skillId))
        );
}

function sanitizeControlledSkuExecutionParams(
    context: AgentContext,
    skillId: string,
    params: Record<string, any>
): Record<string, any> {
    if (!isControlledSkuExecutionRequest(context, skillId)) {
        return params || {};
    }

    const sanitized = { ...(params || {}) };
    delete sanitized.requiresDesignIntelligenceDecision;
    delete sanitized.requiresGenericDesignDecision;
    delete sanitized.designIntelligenceDecision;
    delete sanitized.agentDesignDecision;

    for (const key of ['mode', 'detailMode', 'executionMode']) {
        if (isGenericDesignExecutionMode(sanitized[key])) {
            delete sanitized[key];
        }
    }

    if (!hasSkuNoteDisableIntent(context.userInput)) {
        sanitized.generateNotes = true;
    }

    return sanitized;
}

function sanitizeControlledSkuExecutionMode(
    context: AgentContext,
    skillId: string,
    mode?: string
): string | undefined {
    if (!isControlledSkuExecutionRequest(context, skillId)) {
        return mode;
    }
    return isGenericDesignExecutionMode(mode) ? undefined : mode;
}

function buildLifecycle(
    context: AgentContext,
    input: {
        routeSource: AgentRequestRouteSource;
        route: AgentRequestRoute;
        skillId?: string;
        mode?: string;
        skillParams?: Record<string, unknown>;
        intentSummary?: string;
        reason?: string;
        executionKind?: AgentRequestExecutionKind;
        blockers?: string[];
        warnings?: string[];
        observations?: Array<{ source: string; summary: string }>;
    }
): AgentRequestLifecycleRecord {
    return buildAgentRequestLifecycle({
        userInput: context.userInput,
        context,
        ...input
    });
}

function attachLifecycle(
    result: AgentResult,
    lifecycle: AgentRequestLifecycleRecord,
    intentControlPlane?: AgentIntentControlPlaneDecision,
    entryAgentTaskPlan?: AgentTaskPlanningContract
): AgentResult {
    const resultWithLifecycle = withAgentRequestLifecycle(result, lifecycle);
    const currentData = resultWithLifecycle.data && typeof resultWithLifecycle.data === 'object'
        ? resultWithLifecycle.data as Record<string, unknown>
        : {};
    const planning = entryAgentTaskPlan
        ? {
            intentControlPlane: intentControlPlane || buildAgentIntentControlPlaneDecision({
                userInput: lifecycle.request.rawText,
                hasImageInput: lifecycle.context.hasImageInput,
                hasDocument: lifecycle.context.hasDocument,
                photoshopConnected: lifecycle.context.photoshopConnected
            }),
            agentTaskPlan: entryAgentTaskPlan
        }
        : buildAgentTaskPlanForLifecycle(lifecycle, intentControlPlane);
    const agentTaskPlan = applyRuntimeFailureUserVisibleState(
        planning.agentTaskPlan,
        resultWithLifecycle,
        lifecycle
    );

    return {
        ...resultWithLifecycle,
        data: {
            ...currentData,
            agentIntentControlPlane: planning.intentControlPlane,
            agentTaskPlan,
            agentIntentDeliberationGate: buildAgentIntentDeliberationGate({ lifecycle })
        }
    };
}

function withAssistantReplyOrigin(
    result: AgentResult,
    assistantReplyOrigin: AssistantReplyOrigin
): AgentResult {
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    const resultWithOrigin: AgentResult = {
        ...result,
        assistantReplyOrigin,
        data: {
            ...currentData,
            assistantReplyOrigin
        }
    };
    const notice = buildAgentUserVisibleNoticeFromOrigin(resultWithOrigin, assistantReplyOrigin);
    return notice ? withAgentUserVisibleNotice(resultWithOrigin, notice) : resultWithOrigin;
}

function stripAgentUserVisibleNotice(result: AgentResult): AgentResult {
    const currentData = result.data && typeof result.data === 'object'
        ? { ...(result.data as Record<string, unknown>) }
        : undefined;
    if (currentData) {
        delete currentData.userVisibleNotice;
    }
    const next: AgentResult = {
        ...result,
        ...(currentData ? { data: currentData } : {})
    };
    delete (next as any).userVisibleNotice;
    return next;
}

function readSkillExecutionSummary(result: AgentResult): Record<string, unknown> | undefined {
    const direct = (result as any)?.executionSummary;
    if (direct && typeof direct === 'object') return direct as Record<string, unknown>;
    const data = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : undefined;
    const nested = data?.executionSummary;
    if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
    return undefined;
}

function shouldTreatSkillResultAsToolSummary(result: AgentResult): boolean {
    if (result.success !== false) return true;
    const summary = readSkillExecutionSummary(result);
    const status = String(summary?.status || '').trim();
    const successfulToolCalls = Number(summary?.successfulToolCalls || 0);
    const toolCallCount = Number(summary?.toolCallCount || 0);
    return status === 'needs_review' && successfulToolCalls > 0 && toolCallCount > 0;
}

function resolveSkillResultReplyOrigin(result: AgentResult, skillId: string): AssistantReplyOrigin {
    return shouldTreatSkillResultAsToolSummary(result)
        ? toolSummaryReplyOrigin(`skill:${skillId}${result.success === false ? ':needs-review' : ''}`)
        : deterministicBlockerReplyOrigin(`skill:${skillId}:failure`);
}

type ModelMediatedSkillReplyUnavailableReason =
    | 'missing_call_model'
    | 'unsupported_call_model'
    | 'model_call_threw'
    | 'empty_model_text'
    | 'sanitized_empty';

function previewModelMediationDebugText(value: unknown, maxLength = 4000): string | undefined {
    const text = String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return undefined;
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function describeModelResponseShape(response: unknown): string {
    if (response === null) return 'null';
    if (response === undefined) return 'undefined';
    if (typeof response !== 'object') return typeof response;
    const keys = Object.keys(response as Record<string, unknown>).slice(0, 12);
    return keys.length > 0 ? `object:${keys.join(',')}` : 'object:no-keys';
}

function buildModelMediatedSkillReplyUnavailableResult(
    result: AgentResult,
    skillId: string,
    reason: ModelMediatedSkillReplyUnavailableReason,
    debug?: {
        rawResponse?: unknown;
        rawText?: string;
        sanitizedText?: string;
        error?: unknown;
    }
): AgentResult {
    const stripped = stripAgentUserVisibleNotice(result);
    const currentData = stripped.data && typeof stripped.data === 'object'
        ? stripped.data as Record<string, unknown>
        : {};
    return withAssistantReplyOrigin(
        {
            ...stripped,
            message: '这一步已经拿到工具结果，但当前模型没有生成面向用户的判断。我不会把工具日志直接当成设计结论；请稍后重试或切换可用模型后继续。',
            data: {
                ...currentData,
                modelMediatedUserReplyUnavailable: {
                    version: 'model-mediated-user-reply-unavailable/v0',
                    skillId,
                    reason,
                    rawResponseShape: debug && 'rawResponse' in debug
                        ? describeModelResponseShape(debug.rawResponse)
                        : undefined,
                    rawTextPreview: previewModelMediationDebugText(debug?.rawText),
                    sanitizedTextPreview: previewModelMediationDebugText(debug?.sanitizedText),
                    errorPreview: previewModelMediationDebugText(debug?.error instanceof Error ? debug.error.message : debug?.error)
                }
            }
        },
        uiStatusReplyOrigin(`skill:${skillId}:model-mediated-reply-unavailable`)
    );
}

async function mediateSkillResultUserReplyWithModel(input: {
    result: AgentResult;
    skillId: string;
    context: AgentContext;
    callModel?: ProcessOptions['callModel'];
}): Promise<AgentResult> {
    if (!requiresModelMediatedUserReply({
        skillId: input.skillId,
        success: input.result.success,
        userVisibleKind: 'tool_summary'
    })) {
        return withAssistantReplyOrigin(
            input.result,
            resolveSkillResultReplyOrigin(input.result, input.skillId)
        );
    }

    if (!input.callModel) {
        return buildModelMediatedSkillReplyUnavailableResult(input.result, input.skillId, 'missing_call_model');
    }

    if ((input.callModel as any).supportsModelMediatedUserReply !== true) {
        return buildModelMediatedSkillReplyUnavailableResult(input.result, input.skillId, 'unsupported_call_model');
    }

    try {
        const modelResponse = await input.callModel(
            buildModelMediatedSkillReplyMessages({
                userInput: input.context.userInput,
                skillId: input.skillId,
                skillResultMessage: input.result.message,
                resultData: input.result.data
            }),
            {
                temperature: 0.2,
                maxTokens: 700,
                stream: false,
                purpose: 'skill_result_user_reply',
                includeAttachedImages: false
            }
        );
        const rawModelText = extractModelVisibleText(modelResponse);
        if (!rawModelText) {
            return buildModelMediatedSkillReplyUnavailableResult(
                input.result,
                input.skillId,
                'empty_model_text',
                { rawResponse: modelResponse }
            );
        }
        const modelText = sanitizeUserVisibleAssistantBodyText(rawModelText);
        if (!modelText) {
            return buildModelMediatedSkillReplyUnavailableResult(
                input.result,
                input.skillId,
                'sanitized_empty',
                {
                    rawResponse: modelResponse,
                    rawText: rawModelText,
                    sanitizedText: modelText
                }
            );
        }
        return withAssistantReplyOrigin(
            {
                ...stripAgentUserVisibleNotice(input.result),
                message: modelText,
                data: {
                    ...(input.result.data && typeof input.result.data === 'object' ? input.result.data : {}),
                    modelMediatedUserReply: {
                        version: 'model-mediated-user-reply/v0',
                        skillId: input.skillId,
                        modelPurpose: 'skill_result_user_reply'
                    }
                }
            },
            modelAuthoredReplyOrigin(`skill:${input.skillId}:model-mediated-user-reply`, 'skill_result_user_reply')
        );
    } catch (error) {
        console.warn(`[DesignAgentEngine] 模型组织 skill 用户回复失败：${input.skillId}`, error);
        return buildModelMediatedSkillReplyUnavailableResult(
            input.result,
            input.skillId,
            'model_call_threw',
            { error }
        );
    }
}

function withAgentUserVisibleNotice(
    result: AgentResult,
    notice: AgentUserVisibleNotice
): AgentResult {
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    return {
        ...result,
        userVisibleNotice: notice,
        data: {
            ...currentData,
            userVisibleNotice: notice
        }
    };
}

function buildAgentUserVisibleNoticeFromOrigin(
    result: AgentResult,
    assistantReplyOrigin: AssistantReplyOrigin
): AgentUserVisibleNotice | undefined {
    const content = String(result.message || '').trim();
    if (!content) return undefined;

    if (assistantReplyOrigin.userVisibleKind === 'status_notice') {
        return {
            kind: 'status_notice',
            content,
            source: assistantReplyOrigin.source
        };
    }
    if (assistantReplyOrigin.userVisibleKind === 'tool_summary') {
        return {
            kind: 'tool_summary',
            content,
            source: assistantReplyOrigin.source
        };
    }
    if (assistantReplyOrigin.userVisibleKind === 'blocker_notice') {
        return {
            kind: 'blocker_notice',
            content,
            source: assistantReplyOrigin.source
        };
    }
    return undefined;
}
function collectRuntimeFailureText(result: AgentResult): string {
    const parts: unknown[] = [
        result.error,
        result.message
    ];
    for (const toolResult of Array.isArray(result.toolResults) ? result.toolResults : []) {
        if (!toolResult || typeof toolResult !== 'object') continue;
        const record = toolResult as Record<string, unknown>;
        parts.push(record.error, record.message, record.status, record.summary);
    }
    return parts
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 6000);
}

function resolveRuntimeFailureStatus(
    result: AgentResult,
    lifecycle: AgentRequestLifecycleRecord
): string {
    if (result.success !== false) return '';

    const text = collectRuntimeFailureText(result);
    if (/(?:SKU document not found|未找到当前项目的\S*SKU|未找到当前项目.*SKU|SKU\s+PSD\/PSB|SKU.*PSD\/PSB)/i.test(text)) {
        return 'blocked_missing_sku_source_file';
    }
    if (/(?:photoshop_not_connected|Photoshop\s*未连接|未连接\s*Photoshop|plugin.*not connected|not connected to Photoshop)/i.test(text)) {
        return 'blocked_missing_photoshop_connection';
    }
    if (/(?:photoshop_document_required|没有打开文档|当前没有打开文档|no document|document required|target document not found)/i.test(text)) {
        return 'blocked_missing_document';
    }
    return '';
}

function applyRuntimeFailureUserVisibleState(
    agentTaskPlan: AgentTaskPlanningContract,
    result: AgentResult,
    lifecycle: AgentRequestLifecycleRecord
): AgentTaskPlanningContract {
    const runtimeStatus = resolveRuntimeFailureStatus(result, lifecycle);
    if (!runtimeStatus) return agentTaskPlan;

    return {
        ...agentTaskPlan,
        userVisibleState: buildAgentUserVisibleState({
            route: lifecycle.decision.route,
            planningStatus: runtimeStatus,
            requestKind: agentTaskPlan.requestKind
        }),
        blockers: Array.from(new Set([
            ...agentTaskPlan.blockers,
            runtimeStatus
        ])),
        planningContext: [
            ...agentTaskPlan.planningContext,
            {
                source: 'agent-runtime-failure',
                summary: `runtimeStatus=${runtimeStatus}`
            }
        ]
    };
}

function buildAgentTaskPlanForLifecycle(
    lifecycle: AgentRequestLifecycleRecord,
    intentControlPlane?: AgentIntentControlPlaneDecision,
    forcePublicPlanGeneration = false
): {
    intentControlPlane: AgentIntentControlPlaneDecision;
    agentTaskPlan: AgentTaskPlanningContract;
} {
    const resolvedIntentControlPlane = intentControlPlane || buildAgentIntentControlPlaneDecision({
        userInput: lifecycle.request.rawText,
        hasImageInput: lifecycle.context.hasImageInput,
        hasDocument: lifecycle.context.hasDocument,
        photoshopConnected: lifecycle.context.photoshopConnected
    });

    return {
        intentControlPlane: resolvedIntentControlPlane,
        agentTaskPlan: buildAgentTaskPlanningContract({
            userInput: lifecycle.request.rawText,
            intentControlPlane: resolvedIntentControlPlane,
            lifecycle,
            skillId: lifecycle.decision.selectedSkillId || lifecycle.decision.skillId,
            taskType: lifecycle.decision.taskType,
            workMode: lifecycle.decision.workMode,
            mode: lifecycle.decision.mode,
            skillParams: lifecycle.decision.skillParams,
            forcePublicPlanGeneration
        })
    };
}

function buildAgentTaskPlanBlockedMessage(agentTaskPlan: AgentTaskPlanningContract): string {
    if (agentTaskPlan.status === 'ready_for_model_planning') {
        return buildConversationalUnavailableMessage({ audience: 'general', kind: 'unknown' });
    }
    if (agentTaskPlan.status === 'blocked_needs_clarification') {
        return buildConversationalUnavailableMessage({ audience: 'general', kind: 'unknown' });
    }
    return buildConversationalUnavailableMessage({ audience: 'general', kind: 'unknown' });
}

function buildAgentTaskPlanBlockedError(agentTaskPlan: AgentTaskPlanningContract): string {
    if (agentTaskPlan.status === 'ready_for_model_planning') return 'agent_task_plan_requires_model_planning';
    if (agentTaskPlan.status === 'blocked_needs_clarification') return 'agent_task_plan_requires_clarification';
    return 'agent_task_plan_blocks_tool_execution';
}

function shouldBlockExecutionByAgentTaskPlan(agentTaskPlan: AgentTaskPlanningContract): boolean {
    return agentTaskPlan.executionPlan.canExecuteTools !== true;
}

interface AgentTaskPublicPlan {
    status: 'ready';
    source: 'model';
    canExecuteTools: false;
    message: string;
    proposedWriteTools: string[];
    readbackTargets: string[];
    requiresUserConfirmation: true;
    executionPlanSummary?: string;
    requiredInputs: string[];
    verificationTargets: string[];
    generatedAt: string;
}

type AgentTaskPublicPlanPayload = Omit<
    AgentTaskPublicPlan,
    'status' | 'source' | 'canExecuteTools' | 'requiredInputs' | 'verificationTargets' | 'generatedAt'
> & {
    runtimeOperationRequests: AgentTaskPublicPlanControlledOperationRequest[];
};

interface AgentTaskPublicPlanDraft {
    publicPlan: AgentTaskPublicPlan;
    runtimeOperationRequests: AgentTaskPublicPlanControlledOperationRequest[];
}

class AgentTaskPublicPlanModelUnavailableError extends Error {
    constructor() {
        super('agent_task_public_plan_model_unavailable');
        this.name = 'AgentTaskPublicPlanModelUnavailableError';
    }
}

function isAgentTaskPublicPlanAbortError(error: unknown, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true;
    if (!error || typeof error !== 'object') return false;
    const value = error as { name?: unknown; code?: unknown };
    return value.name === 'AbortError' || value.code === 'ABORT_ERR';
}

function buildGeneratedPublicPlanApprovalRecord(input: {
    context: AgentContext;
    planning: ReturnType<typeof buildAgentTaskPlanForLifecycle>;
    publicPlan: AgentTaskPublicPlan;
    executionRequest: unknown;
}): Record<string, unknown> {
    const request = input.executionRequest && typeof input.executionRequest === 'object'
        ? input.executionRequest as Record<string, unknown>
        : {};
    return {
        version: 'agent-task-public-plan-approval-record/v0',
        requested: true,
        status: 'approved_controlled_execution_request',
        userConfirmed: true,
        requestId: request.requestId || input.context.agentTaskPublicPlanApproval?.requestId,
        sourceMessageId: input.context.agentTaskPublicPlanApproval?.sourceMessageId,
        allowedWriteTools: request.allowedWriteTools || input.context.agentTaskPublicPlanApproval?.allowedWriteTools || [],
        approvedWriteTools: request.approvedWriteTools || [],
        blockedWriteTools: request.blockedWriteTools || [],
        enableControlledExecutionRequest: true,
        blockers: [],
        warnings: ['用户首轮已经明确要求完成交付；系统按一次性文档范围执行公开方案。'],
        agentTaskPlan: input.planning.agentTaskPlan,
        agentTaskPublicPlan: input.publicPlan
    };
}

async function runGeneratedPublicPlanIfApproved(input: {
    context: AgentContext;
    planning: ReturnType<typeof buildAgentTaskPlanForLifecycle>;
    lifecycle: AgentRequestLifecycleRecord;
    publicPlan: AgentTaskPublicPlan;
    executionRequest: ReturnType<typeof buildAgentTaskPublicPlanExecutionRequest>;
    repairSkillId: string;
    repairParams?: Record<string, unknown>;
    signal?: AbortSignal;
    callbacks: ProcessOptions['callbacks'];
    callModel?: ProcessOptions['callModel'];
}): Promise<AgentResult | null> {
    const approval = input.context.agentTaskPublicPlanApproval;
    if (approval?.approveGeneratedPublicPlan !== true || approval.userConfirmed !== true) return null;

    input.callbacks?.onStep?.({
        kind: 'observation',
        title: '准备按方案处理',
        detail: input.publicPlan.executionPlanSummary
            || input.publicPlan.message
            || '先按已确认的阶段目标处理画面，完成后再看真实结果。',
        status: 'success',
        percent: 32
    });

    const controlledRun = await runAgentTaskPublicPlanControlledRunnerAsync({
        request: input.executionRequest,
        executionTarget: approval.executionTarget,
        allowPhotoshopWrites: approval.allowPhotoshopWrites,
        liveExecutionScope: approval.liveExecutionScope,
        explicitProjectWriteApproval: approval.explicitProjectWriteApproval,
        adapter: approval.adapter
    });

    emitControlledRunVisibleReview(input.callbacks, controlledRun);

    if (shouldRepairAfterControlledRunObservation(controlledRun)) {
        const agentReActObservation = buildAgentReActObservationFromPublicPlanRun(controlledRun);
        const repairTask = buildControlledRunRepairTaskText({
            context: input.context,
            run: controlledRun
        });
        input.callbacks?.onStep?.({
            kind: 'observation',
            title: '继续修复画面',
            detail: agentReActObservation.summary || '真实画面和计划不一致，回到 Agent 继续修复。',
            status: 'running',
            percent: 86
        });
        const repairResult = await executeSkillWithExecutor(input.repairSkillId, {
            params: {
                ...(input.repairParams || {}),
                userTask: repairTask,
                task: repairTask,
                originalUserTask: input.context.userInput,
                skillId: input.repairSkillId,
                agentIntentControlPlane: input.planning.intentControlPlane,
                agentReActObservation,
                maxIterations: 8
            },
            callbacks: input.callbacks,
            signal: input.signal,
            context: input.context,
            agentTaskPlan: input.planning.agentTaskPlan
        });
        const repairResultWithOrigin = await mediateSkillResultUserReplyWithModel({
            result: repairResult,
            skillId: input.repairSkillId,
            context: input.context,
            callModel: input.callModel
        });
        const repairResultWithObservation = attachAgentReActObservation(
            repairResultWithOrigin,
            buildAgentReActObservationFromSkillResult({
                skillId: input.repairSkillId,
                result: repairResultWithOrigin
            })
        );
        return attachLifecycle(
            repairResultWithObservation,
            {
                ...input.lifecycle,
                decision: {
                    ...input.lifecycle.decision,
                    route: 'skill_execution',
                    skillId: input.repairSkillId,
                    reason: '复核时发现真实画面和计划不一致，已把观察差异交回 Agent 继续修复。'
                },
                execution: {
                    ...input.lifecycle.execution,
                    kind: 'deterministic_skill',
                    expectedExecutor: input.repairSkillId,
                    requiresPhotoshop: true,
                    canStart: true
                },
                warnings: [
                    ...(input.lifecycle.warnings || []),
                    ...controlledRun.warnings
                ],
                blockers: [
                    ...(input.lifecycle.blockers || []),
                    ...(repairResult.success === false ? controlledRun.blockers : [])
                ]
            },
            input.planning.intentControlPlane,
            input.planning.agentTaskPlan
        );
    }

    return attachLifecycle(
        buildPublicPlanControlledRunResult({
            approvalRecord: buildGeneratedPublicPlanApprovalRecord({
                context: input.context,
                planning: input.planning,
                publicPlan: input.publicPlan,
                executionRequest: input.executionRequest
            }),
            executionRequest: input.executionRequest,
            controlledRun
        }),
        {
            ...input.lifecycle,
            decision: {
                ...input.lifecycle.decision,
                route: 'skill_execution',
                skillId: 'autonomous-agent',
                reason: isCompletedPublicPlanControlledRun(controlledRun)
                    ? '首轮明确交付请求已授权一次性文档范围，生成公开方案后交给受控 runner 执行并复核。'
                    : '首轮明确交付请求已生成公开方案，但受控 runner 条件不足。'
            },
            execution: {
                ...input.lifecycle.execution,
                kind: 'deterministic_skill',
                expectedExecutor: 'autonomous-agent',
                requiresPhotoshop: true,
                canStart: true
            },
            warnings: [
                ...(input.lifecycle.warnings || []),
                ...controlledRun.warnings
            ],
            blockers: [
                ...(input.lifecycle.blockers || []),
                ...controlledRun.blockers
            ]
        },
        input.planning.intentControlPlane,
        input.planning.agentTaskPlan
    );
}

function sanitizeAgentTaskPublicPlanDisplayText(value: unknown, maxLength = 1200): string {
    const text = String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]')
        .replace(/\s+\n/g, '\n')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function sanitizePublicPlanUserFacingText(value: unknown, maxLength = 1200): string {
    return sanitizeAgentTaskPublicPlanDisplayText(value, maxLength)
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
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeAgentTaskPublicPlanStringList(value: unknown, limit = 12): string[] {
    if (!Array.isArray(value)) return [];
    const output: string[] = [];
    for (const item of value) {
        const text = sanitizeAgentTaskPublicPlanDisplayText(item, 80).replace(/\s+/g, ' ').trim();
        if (!text || output.includes(text)) continue;
        output.push(text);
        if (output.length >= limit) break;
    }
    return output;
}

function isAgentTaskPublicPlanRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAgentTaskPublicPlanOperationRequests(
    value: unknown,
    proposedWriteTools: string[],
    fallbackReadbackTargets: string[]
): AgentTaskPublicPlanControlledOperationRequest[] {
    if (!Array.isArray(value) || proposedWriteTools.length === 0) return [];
    const allowedToolSet = new Set(proposedWriteTools);
    const output: AgentTaskPublicPlanControlledOperationRequest[] = [];

    value.slice(0, 12).forEach((item, index) => {
        if (!isAgentTaskPublicPlanRecord(item)) return;
        const toolName = sanitizeAgentTaskPublicPlanDisplayText(item.toolName, 80).replace(/\s+/g, ' ').trim();
        if (!toolName || !allowedToolSet.has(toolName)) return;
        if (item.params === undefined || item.params === null) return;

        const readbackTargets = normalizeAgentTaskPublicPlanStringList(item.readbackTargets);
        const effectiveReadbackTargets = readbackTargets.length > 0
            ? readbackTargets
            : [...fallbackReadbackTargets];
        if (effectiveReadbackTargets.length === 0) return;

        output.push({
            operationId: sanitizeAgentTaskPublicPlanDisplayText(item.operationId, 80).replace(/\s+/g, ' ').trim()
                || `public-plan-op-${index + 1}`,
            toolName,
            params: item.params,
            paramsSummary: sanitizeAgentTaskPublicPlanDisplayText(item.paramsSummary, 240),
            readbackTargets: effectiveReadbackTargets
        });
    });

    return output;
}

function normalizeAgentTaskPublicPlanResponse(
    response: { text?: string; thinking?: string } | undefined
): AgentTaskPublicPlanPayload | null {
    const text = resolveModelThinking(response?.text || response?.thinking);
    if (!text) return null;
    if (isToolCallLikeText(text)) return null;

    const parsed = parseJsonObjectBlock(text);
    if (parsed) {
        const message = sanitizeAgentTaskPublicPlanDisplayText(parsed.message);
        const proposedWriteTools = normalizeAgentTaskPublicPlanStringList(
            Array.isArray(parsed.proposedWriteTools)
                ? parsed.proposedWriteTools
                : parsed.writeToolAllowlist
        );
        const readbackTargets = normalizeAgentTaskPublicPlanStringList(parsed.readbackTargets);
        const executionPlanSummary = sanitizeAgentTaskPublicPlanDisplayText(parsed.executionPlanSummary, 240);
        if (!message) return null;
        return {
            message,
            proposedWriteTools,
            readbackTargets,
            requiresUserConfirmation: true,
            executionPlanSummary: executionPlanSummary || undefined,
            runtimeOperationRequests: normalizeAgentTaskPublicPlanOperationRequests(
                parsed.operationRequests,
                proposedWriteTools,
                readbackTargets
            )
        };
    }

    if (isStructuredRouterLikeText(text)) return null;
    const message = sanitizeAgentTaskPublicPlanDisplayText(text);
    if (!message) return null;
    return {
        message,
        proposedWriteTools: [],
        readbackTargets: [],
        requiresUserConfirmation: true,
        runtimeOperationRequests: []
    };
}

function shouldValidateExecutablePublicPlanPayload(payload: AgentTaskPublicPlanPayload): boolean {
    const proposedWriteTools = normalizeAgentTaskPublicPlanStringList(payload.proposedWriteTools);
    return proposedWriteTools.some((toolName) => (
        toolName === 'renderLayout'
        || toolName === 'placeImage'
        || toolName === 'saveDocument'
        || toolName === 'createDocument'
    ));
}

function collectExecutablePublicPlanPayloadBlockers(payload: AgentTaskPublicPlanPayload): string[] {
    if (!shouldValidateExecutablePublicPlanPayload(payload)) return [];

    const proposedWriteTools = normalizeAgentTaskPublicPlanStringList(payload.proposedWriteTools);
    const operationRequests = Array.isArray(payload.runtimeOperationRequests)
        ? payload.runtimeOperationRequests
        : [];
    const blockers: string[] = [];
    if (proposedWriteTools.length > 0 && operationRequests.length === 0) {
        blockers.push('operationRequests 缺失，无法按确认方案创建画面。');
    }
    if (
        proposedWriteTools.includes('renderLayout')
        && !operationRequests.some((operation) => operation.toolName === 'renderLayout')
    ) {
        blockers.push('renderLayout operationRequests 缺失，无法创建版面模块。');
    }
    blockers.push(...collectAgentTaskPublicPlanOperationParamBlockers(operationRequests));
    return Array.from(new Set(blockers)).filter(Boolean);
}

function shouldRequireExecutablePublicPlanPayload(
    context: AgentContext,
    agentTaskPlan: AgentTaskPlanningContract
): boolean {
    const approval = context.agentTaskPublicPlanApproval;
    return agentTaskPlan.requestKind === 'autonomous_execution'
        && agentTaskPlan.allowedToolScope === 'write_photoshop'
        && approval?.approveGeneratedPublicPlan === true
        && approval.userConfirmed === true;
}

function collectRequiredExecutablePublicPlanBlockers(
    context: AgentContext,
    agentTaskPlan: AgentTaskPlanningContract,
    payload: AgentTaskPublicPlanPayload
): string[] {
    if (!shouldRequireExecutablePublicPlanPayload(context, agentTaskPlan)) {
        return [];
    }
    const proposedWriteTools = normalizeAgentTaskPublicPlanStringList(payload.proposedWriteTools);
    const operationRequests = Array.isArray(payload.runtimeOperationRequests)
        ? payload.runtimeOperationRequests
        : [];
    const blockers: string[] = [];
    if (proposedWriteTools.length === 0) {
        blockers.push('公开计划缺少画面创建或导出动作，不能只给文字方案。');
    }
    if (operationRequests.length === 0) {
        blockers.push('operationRequests 缺失，无法按确认方案创建画面。');
    }
    return blockers;
}

async function requestAgentTaskPublicPlan(
    context: AgentContext,
    agentTaskPlan: AgentTaskPlanningContract,
    lifecycle: AgentRequestLifecycleRecord,
    readonlyContext: AgentTaskPublicPlanReadonlyContext,
    callModel: NonNullable<ProcessOptions['callModel']>,
    callbacks: ProcessOptions['callbacks'],
    signal?: AbortSignal
): Promise<AgentTaskPublicPlanDraft | null> {
    callbacks?.onStep?.({
        kind: 'model_request',
        title: '梳理设计方向',
        detail: '先让模型整理画面重点、版式方向和效果检查方式，本轮先不改动画面。',
        status: 'running',
        percent: 27
    });

    const prompt = [
        '请为 DesignEcho Agent 生成执行 Photoshop 工具前可展示给用户的设计方案、处理范围和效果检查方式。',
        '这是计划，不是执行结果。',
        '只返回严格 JSON 对象，不要 Markdown。',
        '',
        'JSON 字段：',
        '{',
        '  "message": "给用户看的设计方案，简体中文，3 到 6 个短步骤，必须说明本轮尚未改动画面",',
        '  "writeToolAllowlist": ["后续如获用户确认，计划允许的 Photoshop 写工具名"],',
        '  "readbackTargets": ["每次写入后必须执行的读回检查目标，例如 layer_hierarchy 或 acceptance_snapshot"],',
        '  "requiresUserConfirmation": true,',
        '  "executionPlanSummary": "一句话说明后续处理计划，不包含本地路径或原始图片 payload",',
        '  "operationRequests": [',
        '    { "operationId": "稳定操作 ID", "toolName": "白名单内的写工具名", "params": { "仅包含可执行工具参数，不包含本地路径、编码后的图片正文、原始图片或文件 payload" }, "paramsSummary": "给用户看的参数摘要", "readbackTargets": ["该操作后的读回目标"] }',
        '  ]',
        '}',
        '',
        '硬性要求：',
        '1. message 可以展示给用户，但不要声称已经修改或导出任何内容。',
        '2. message 面向真实使用者：只说画面会呈现什么、哪些文案会放进去、哪些内容后续可编辑，以及还需要确认后才会动手。',
        '3. 不要在 message 里出现工具名、路由名、字段名、内部执行状态、日志口吻或工程解释。',
        '4. 不要使用 route、skill、executor、template authoring、deterministic、autonomous、readbackTargets、writeToolAllowlist、operationRequests 等内部词。',
        '5. 真实设计请求的 message 要优先复述用户给定的可见内容，例如标题、卖点、尺寸、风格限制；不要写“核心卖点”“标题占位”“模板类型”这类占位话术。',
        '6. writeToolAllowlist 只列出确实需要的写工具；纯分析/评审类只读任务必须返回空数组。',
        '7. readbackTargets 必须给出至少一个检查目标（如 layer_hierarchy 或 acceptance_snapshot）：写类任务用于写入后的读回验收，只读评审任务用于记录支撑分析结论的读取结果。不允许为空。',
        '8. 不要输出工具调用 XML，不要暴露私有链式思维。',
        '9. 不要输出分数、confidence、score 或没有依据的质量结论。',
        '10. operationRequests 只用于确认后的处理草稿，工具必须来自 writeToolAllowlist；不能包含本地路径、编码后的图片正文、原始图片、文件 payload 或未授权工具。',
        '11. operationRequests 是能力中立的执行信封：根据用户目标、当前文档、可用能力和只读观察结果选择最小充分动作，不预设 createDocument、renderLayout 或任何固定工具顺序。',
        '12. 不要因为任务名称、品类或“从零创建”等措辞自行补入固定画布尺寸、固定模板、默认标题、默认卖点或默认模块；缺少关键输入时应在 message 中明确待确认信息，不得伪造可执行参数。',
        '13. 每个 operationRequest 必须有稳定 operationId、白名单内 toolName、符合该工具契约的完整 params，以及至少一个写后读回目标；动作顺序由本次计划决定，并应保留为可回放序列。',
        '14. 只在用户目标确实要求且当前状态尚未满足时加入新建、置入、排版、保存或导出动作；已有文档可直接编辑时不要为了套流程重复新建文档。',
        '15. 需要项目素材时，使用工具支持的项目资源选择参数，不要写本地绝对路径、编码后的图片正文或文件 payload；多个空间写入动作必须给出可区分且不越界、不重叠的目标区域。',
        '16. 如果选择 renderLayout，params.canvas 和非空 blocks 必须完整，block role 必须符合工具 schema，可见 content 必须来自用户输入或当前上下文与观察结果，不得使用占位文案或内部规划语句。',
        '17. 如果选择 placeImage，应描述素材选择要求和目标区域；如果它与文字布局共同执行，应明确不会遮挡需要保留的可见内容。',
        '18. 如果选择 saveDocument 或导出能力，只有用户要求交付时才加入，并使用工具支持的项目相对位置/格式参数，禁止本地绝对路径。',
        '19. Skill 的专业方法、阶段结构和质量标准由对应 Skill/Capability 契约提供；本公共计划不得自行注入某个品类的阶段计划、内容顺序或方法论。',
        '20. 纯分析或信息不足的任务可以不产生写动作，但仍需给出基于只读结果的检查目标；需要写入的明确交付任务则必须给出至少一个具体写动作及其读回检查。',
        '21. 先使用只读上下文中已经提供的文档、图层、文本、画面和项目内容，再判断是否缺少用户输入。不得把工具可读取的现有内容、风格、长度或结构列成用户必须补充的前置条件；只有观察不可用、结果仍有多个高风险解释，或缺失选择会实质改变交付时才请求确认，同时不得虚构当前上下文与观察结果中不存在的产品事实。',
        '',
        '用户请求：',
        context.userInput,
        '',
        '请求边界：',
        `route=${agentTaskPlan.route}`,
        `skillId=${agentTaskPlan.skillId || 'none'}`,
        `requestKind=${agentTaskPlan.requestKind}`,
        `allowedToolScope=${agentTaskPlan.allowedToolScope}`,
        `canExecuteTools=${agentTaskPlan.executionPlan.canExecuteTools}`,
        '',
        '计划需要覆盖的必要输入：',
        agentTaskPlan.requiredInputs.join(', ') || 'none',
        '',
        '最低效果检查方式：',
        agentTaskPlan.executionPlan.verificationTargets.join(', ') || 'none',
        '',
        '当前上下文摘要：',
        ...(context.operatingContextSnapshot
            ? [compileOperatingContextPrompt(context.operatingContextSnapshot)]
            : [
                `photoshopConnected=${lifecycle.context.photoshopConnected}`,
                `hasDocument=${lifecycle.context.hasDocument}`,
                `documentName=${lifecycle.context.documentName || 'unknown'}`,
                `hasProject=${lifecycle.context.hasProject}`,
                `projectLabel=${resolveProjectLabelForPublicPlan(context.projectContext as Record<string, unknown> | undefined)}`
            ]),
        '',
        '只读上下文摘要：',
        ...formatAgentTaskPublicPlanReadonlyContext(readonlyContext)
    ].join('\n');

    try {
        let publicPlanPayload: AgentTaskPublicPlanPayload | null = null;
        let repairBlockers: string[] = [];
        const maxPublicPlanAttempts = 3;
        let modelResponseCount = 0;
        let modelCallFailureCount = 0;
        for (let attempt = 0; attempt < maxPublicPlanAttempts; attempt += 1) {
            if (signal?.aborted) {
                const abortError = new Error('agent_task_public_plan_aborted');
                abortError.name = 'AbortError';
                throw abortError;
            }
            const activePrompt = repairBlockers.length === 0
                ? prompt
                : [
                    prompt,
                    '',
                    '上一次 JSON 还不能直接创建画面，原因：',
                    ...repairBlockers.map((blocker) => `- ${blocker}`),
                    '',
                    '请只返回修正后的严格 JSON。不要解释。',
                    '必须保留用户可见 message，但补齐 operationRequests 中每个写入动作的可执行 params。',
                    '只修复上面列出的阻塞项，不要补入用户未要求的固定工具、固定顺序、默认画布、默认文案、品类模板或阶段计划。',
                    '每个 operationRequest 的 toolName 必须在 writeToolAllowlist 内，params 必须符合所选工具契约并且可回放，readbackTargets 不得为空。',
                    '如果包含 renderLayout，params.canvas 和非空 blocks 必须完整；block role 必须符合工具 schema，content 必须来自用户输入或当前上下文与观察结果，不得是占位话术或内部规划语句。',
                    '如果包含多个空间写入动作，各自目标区域必须可区分、在画布内且不互相遮挡；不要通过扩大或新建画布来掩盖未经确认的参数缺失。'
                ].join('\n');
            let response: Awaited<ReturnType<typeof callModel>>;
            try {
                response = await callModel(
                    [
                        {
                            role: 'system',
                            content: [
                                buildAgentOperatingProfilePromptSection(),
                                'Return only strict JSON for a public user-visible design plan and controlled execution boundary.',
                                'Do not call tools. Do not reveal private chain-of-thought.'
                            ].join('\n')
                        },
                        { role: 'user', content: activePrompt }
                    ],
                    {
                        temperature: repairBlockers.length === 0 ? 0.2 : 0.1,
                        // 计划 JSON 含多步骤 message + 工具白名单 + operationRequests 数组，
                        // 700 tokens 必然截断（实测：计划卡片「步骤待补充/缺少关键信息」全因截断）
                        maxTokens: 2600,
                        purpose: 'agent_task_public_plan',
                        modelCandidateOffset: attempt,
                        stream: false
                    }
                );
                modelResponseCount += 1;
            } catch (error) {
                if (isAgentTaskPublicPlanAbortError(error, signal)) throw error;
                modelCallFailureCount += 1;
                console.warn('[DesignAgentEngine] public plan model candidate unavailable:', {
                    attempt: attempt + 1,
                    maxAttempts: maxPublicPlanAttempts
                });
                if (attempt < maxPublicPlanAttempts - 1) {
                    callbacks?.onStep?.({
                        kind: 'model_response',
                        title: '切换备用模型',
                        detail: '当前模型没有返回设计方案，正在尝试下一个可用候选。',
                        status: 'running',
                        percent: 28
                    });
                    continue;
                }
                break;
            }
            publicPlanPayload = normalizeAgentTaskPublicPlanResponse(response);
            repairBlockers = publicPlanPayload
                ? [
                    ...collectRequiredExecutablePublicPlanBlockers(context, agentTaskPlan, publicPlanPayload),
                    ...collectExecutablePublicPlanPayloadBlockers(publicPlanPayload)
                ]
                : ['模型没有返回可展示且可执行的计划 JSON。'];
            repairBlockers = Array.from(new Set(repairBlockers)).filter(Boolean);
            if (repairBlockers.length > 0) {
                console.warn('[DesignAgentEngine] public plan attempt not executable:', {
                    attempt: attempt + 1,
                    maxAttempts: maxPublicPlanAttempts,
                    hasPayload: Boolean(publicPlanPayload),
                    blockers: repairBlockers.slice(0, 8)
                });
            }
            if (repairBlockers.length > 0 && attempt < maxPublicPlanAttempts - 1) {
                callbacks?.onStep?.({
                    kind: 'model_response',
                    title: '补齐画面创建条件',
                    detail: '设计方案里缺少可直接创建画面的版面信息，正在让模型补齐。',
                    status: 'running',
                    percent: 28
                });
                continue;
            }
            break;
        }
        if (modelResponseCount === 0 && modelCallFailureCount === maxPublicPlanAttempts) {
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '设计方向生成失败',
                detail: '当前模型服务和备用候选都未返回设计方案；本轮不会改动画面。',
                status: 'error',
                percent: 28,
                issue: 'agent_task_public_plan_model_unavailable'
            });
            throw new AgentTaskPublicPlanModelUnavailableError();
        }
        if (publicPlanPayload && repairBlockers.length > 0) {
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '画面创建条件不足',
                detail: '模型多次整理后仍存在图文重叠、文案或参数问题；本轮不会改动画面。',
                status: 'error',
                percent: 28,
                issue: 'agent_task_public_plan_unresolved_blockers'
            });
            return null;
        }
        if (!publicPlanPayload) {
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '设计方向不可用',
                detail: '模型没有返回可直接展示的设计方案；本轮不会改动画面。',
                status: 'error',
                percent: 28,
                issue: 'agent_task_public_plan_unavailable'
            });
            return null;
        }
        callbacks?.onStep?.({
            kind: 'model_response',
            title: '设计方向',
            detail: publicPlanPayload.message,
            status: 'success',
            percent: 29
        });
        callbacks?.onStatus?.('已整理设计方向，尚未改动画面。');
        // 读回目标不能依赖模型自觉：模型偶发返回空数组会让计划卡死在「待补充」
        // 且用户无法确认（计划 status 停在 blocked 而非 pending_user_confirmation）。
        // 三级来源：模型给的 → 任务契约 verificationTargets → 通用验收检查。
        // autonomous 设计执行任务的 verificationTargets 常为空，必须有最终检查项，
        // 否则「确认计划」找不到 pending plan，批准链断裂落回对话（实测 C-1188 主图）。
        const readbackTargets = publicPlanPayload.readbackTargets.length > 0
            ? publicPlanPayload.readbackTargets
            : agentTaskPlan.executionPlan.verificationTargets.length > 0
                ? [...agentTaskPlan.executionPlan.verificationTargets]
                : ['acceptance_snapshot', 'layer_hierarchy'];
        const publicPlan: AgentTaskPublicPlan = {
            status: 'ready',
            source: 'model',
            canExecuteTools: false,
            message: publicPlanPayload.message,
            proposedWriteTools: publicPlanPayload.proposedWriteTools,
            readbackTargets,
            requiresUserConfirmation: true,
            executionPlanSummary: publicPlanPayload.executionPlanSummary,
            requiredInputs: agentTaskPlan.requiredInputs,
            verificationTargets: agentTaskPlan.executionPlan.verificationTargets,
            generatedAt: new Date().toISOString()
        };
        return {
            publicPlan,
            runtimeOperationRequests: publicPlanPayload.runtimeOperationRequests
        };
    } catch (error) {
        if (error instanceof AgentTaskPublicPlanModelUnavailableError
            || isAgentTaskPublicPlanAbortError(error, signal)) {
            throw error;
        }
        console.warn('[DesignAgentEngine] agent task public plan failed:', error);
        callbacks?.onStep?.({
            kind: 'model_response',
            title: '设计方向生成失败',
            detail: '模型没有整理出可展示的设计方案；本轮不会改动画面。',
            status: 'error',
            percent: 28,
            issue: 'agent_task_public_plan_failed'
        });
        return null;
    }
}

function buildAgentTaskPlanBlockedResult(
    agentTaskPlan: AgentTaskPlanningContract,
    callbacks: ProcessOptions['callbacks']
): AgentResult {
    const message = buildAgentTaskPlanBlockedMessage(agentTaskPlan);
    const error = buildAgentTaskPlanBlockedError(agentTaskPlan);
    callbacks?.onStep?.({
        kind: 'model_response',
        title: '执行前计划未放行',
        detail: message,
        status: 'error',
        percent: 26,
        issue: error
    });
    callbacks?.onStatus?.('需要先完成执行前计划。');
    return withAssistantReplyOrigin(
        {
            success: false,
            message,
            error,
            data: {
                agentTaskPlan
            }
        },
        deterministicBlockerReplyOrigin(`agent-task-plan:${agentTaskPlan.status}`)
    );
}

function attachAgentDesignExecutionPreflight(
    result: AgentResult,
    preflight?: AgentDesignExecutionPreflight
): AgentResult {
    if (!preflight) return result;
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    return {
        ...result,
        data: {
            ...currentData,
            agentDesignExecutionPreflight: preflight
        }
    };
}

function attachAgentReActObservation(
    result: AgentResult,
    observation: AgentReActObservation
): AgentResult {
    const currentData = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    return {
        ...result,
        data: {
            ...currentData,
            agentReActObservation: observation
        }
    };
}

async function buildConversationalAgentResult(
    lightweightIntent: LightweightIntent,
    context: AgentContext,
    message: string,
    options?: {
        callModel?: NonNullable<ProcessOptions['callModel']>;
        assistantReplyOrigin?: AssistantReplyOrigin;
    }
): Promise<AgentResult> {
    const visibleMessage = sanitizeUserVisibleAssistantBodyText(message).trim();
    if (lightweightIntent !== 'continuation') {
        if (visibleMessage) {
            return withAssistantReplyOrigin(
                { success: true, message: visibleMessage },
                options?.assistantReplyOrigin || uiStatusReplyOrigin('conversational:missing-origin')
            );
        }

        return withAssistantReplyOrigin(
            {
                success: false,
                message: resolveConversationalUnavailableMessage(lightweightIntent, context),
                error: 'empty_conversational_reply'
            },
            uiStatusReplyOrigin('conversational:unavailable')
        );
    }

    const agentResumableTaskContract = buildAgentResumableTaskContract({
        userInput: context.userInput,
        conversationHistory: context.conversationHistory
    });
    const agentResumeExecutionPolicy = buildAgentResumeExecutionPolicy(agentResumableTaskContract);
    const operatingPhotoshopConnected = context.operatingContextSnapshot
        ? resolveOperatingPhotoshopConnection(context.operatingContextSnapshot)
        : context.isPluginConnected;
    const operatingPhotoshopHasDocument = context.operatingContextSnapshot
        ? resolveOperatingPhotoshopDocumentPresence(context.operatingContextSnapshot)
        : context.photoshopContext?.hasDocument;
    const agentResumeContextGate = buildAgentResumeContextGate({
        policy: agentResumeExecutionPolicy,
        photoshopConnected: operatingPhotoshopConnected,
        hasDocument: operatingPhotoshopHasDocument,
        documentName: context.photoshopContext?.documentName,
        layerCount: context.photoshopContext?.layerCount,
        hasProject: Boolean(context.projectContext?.projectPath),
        projectPath: context.projectContext?.projectPath,
        hasFreshPhotoshopSnapshot: false,
        hasFreshProjectSnapshot: Boolean(context.projectContext?.contextSnapshot)
    });
    const initialRefreshRun = buildAgentResumeContextRefreshRun({
        gate: agentResumeContextGate
    });
    let agentResumeContextRefreshRun = initialRefreshRun;
    const agentResumeReadonlyContextExecutor = initialRefreshRun.canRequestReadOnlyRefresh
        ? await runAgentResumeReadonlyContextExecutor({
            refreshRun: initialRefreshRun,
            tools: context.resumeReadonlyToolHandlers
        })
        : undefined;

    if (agentResumeReadonlyContextExecutor?.status === 'completed_readonly_refresh') {
        agentResumeContextRefreshRun = buildAgentResumeContextRefreshRun({
            gate: agentResumeContextGate,
            context: agentResumeReadonlyContextExecutor.context
        });
    }

    let agentResumePlanning = buildAgentResumePlanningResult({
        contract: agentResumableTaskContract,
        policy: agentResumeExecutionPolicy,
        gate: agentResumeContextGate,
        refreshRun: agentResumeContextRefreshRun,
        readonlyExecutor: agentResumeReadonlyContextExecutor
    });

    if (agentResumePlanning.status === 'ready_for_model_resume_plan' && options?.callModel) {
        try {
            const modelResponse = await options.callModel(
                buildAgentResumePlanningMessages({
                    contract: agentResumableTaskContract,
                    policy: agentResumeExecutionPolicy,
                    gate: agentResumeContextGate,
                    refreshRun: agentResumeContextRefreshRun,
                    readonlyExecutor: agentResumeReadonlyContextExecutor
                }),
                {
                    temperature: 0.2,
                    maxTokens: 700,
                    stream: false,
                    purpose: 'resume_planning'
                }
            );
            const modelPlanText = String(modelResponse?.text || '').trim();
            agentResumePlanning = buildAgentResumePlanningResult({
                contract: agentResumableTaskContract,
                policy: agentResumeExecutionPolicy,
                gate: agentResumeContextGate,
                refreshRun: agentResumeContextRefreshRun,
                readonlyExecutor: agentResumeReadonlyContextExecutor,
                modelPlanText,
                modelError: modelPlanText ? undefined : new Error('模型未返回恢复计划文本。')
            });
        } catch (error) {
            agentResumePlanning = buildAgentResumePlanningResult({
                contract: agentResumableTaskContract,
                policy: agentResumeExecutionPolicy,
                gate: agentResumeContextGate,
                refreshRun: agentResumeContextRefreshRun,
                readonlyExecutor: agentResumeReadonlyContextExecutor,
                modelError: error
            });
        }
    }

    const agentResumeExecutionGate = buildAgentResumeExecutionGate({
        planning: agentResumePlanning,
        allowedWriteTools: [...DEFAULT_AGENT_RESUME_WRITE_TOOL_ALLOWLIST]
    });
    const agentResumeControlledExecutionRequest = buildAgentResumeControlledExecutionRequest({
        executionGate: agentResumeExecutionGate
    });
    const agentResumeControlledExecutionRunner = runAgentResumeControlledExecutionRunner({
        request: agentResumeControlledExecutionRequest
    });

    return withAssistantReplyOrigin(
        {
            success: true,
            message,
            data: {
                agentResumableTaskContract,
                agentResumeExecutionPolicy,
                agentResumeContextGate,
                agentResumeContextRefreshRun,
                agentResumeReadonlyContextExecutor,
                agentResumePlanning,
                agentResumeExecutionGate,
                agentResumeControlledExecutionRequest,
                agentResumeControlledExecutionRunner
            }
        },
        options?.assistantReplyOrigin || uiStatusReplyOrigin('conversational:continuation:local-status')
    );
}

function mapConversationalFailureKind(
    failure?: ConversationalModelFailure
): Extract<ConversationalModelFailureKind, 'auth' | 'rate_limit' | 'network' | 'unknown'> {
    if (failure?.kind === 'auth' || failure?.kind === 'rate_limit' || failure?.kind === 'network') {
        return failure.kind;
    }
    return 'unknown';
}

function buildConversationalUnavailableStatusResult(
    lightweightIntent: LightweightIntent,
    context: AgentContext,
    failure: ConversationalModelFailure | undefined,
    options?: {
        error?: 'Conversational reply unavailable' | 'conversational_reply_unavailable';
    }
): AgentResult {
    return withAssistantReplyOrigin(
        {
            success: false,
            message: resolveConversationalUnavailableMessage(
                lightweightIntent,
                context,
                mapConversationalFailureKind(failure)
            ),
            error: options?.error || 'Conversational reply unavailable',
            data: {
                ...(failure ? { conversationalModelFailure: failure } : {})
            }
        },
        uiStatusReplyOrigin('conversational:unavailable')
    );
}

function buildModelDecisionLifecycle(
    context: AgentContext,
    decision: Awaited<ReturnType<typeof classifyActionableIntent>>,
    reason: string
): AgentRequestLifecycleRecord {
    return buildLifecycle(context, {
        routeSource: 'model_router',
        route: decision?.route || 'autonomous_agent',
        skillId: decision?.skillId,
        mode: decision?.mode,
        skillParams: decision?.skillParams && typeof decision.skillParams === 'object'
            ? decision.skillParams as Record<string, unknown>
            : undefined,
        intentSummary: resolveIntentSummary(decision),
        reason,
        executionKind: decision?.route === 'skill_execution' || decision?.route === 'autonomous_agent'
            ? undefined
            : 'none'
    });
}

function buildDesignPreflightContextMessage(preflight: AgentDesignExecutionPreflight): string {
    if (preflight.skillId === 'sku-batch' && !preflight.designIntelligencePlan) {
        return 'SKU 已关联专用流程输入；实际文件、模板、配置和导出读回由 SKU Skill 继续检查。';
    }
    if (
        preflight.skillId === 'main-image-design'
        && preflight.requiredInputs.includes('white-background-export-contract')
        && !preflight.designIntelligencePlan
    ) {
        return '白底图已关联项目 SKU 源文件与专用导出流程；实际文件和导出结果由主图 Skill 继续检查。';
    }
    if (preflight.status === 'needs_model_design_decision') {
        return '设计方向仍需补充；已把缺口交给当前 Skill 继续规划，不会在这里终止任务。';
    }
    if (preflight.status === 'needs_visual_observation') {
        return '当前只确认了素材可用性，尚未形成具体视觉理解；当前 Skill 可继续读取或观察图片。';
    }
    if (preflight.status === 'needs_planner_context') {
        return '上游规划上下文尚未完整；当前 Skill 可继续刷新上下文或重新规划。';
    }
    if (preflight.status === 'not_applicable') {
        return '当前任务不需要通用设计上下文整理。';
    }
    return '设计上下文已整理并交给当前 Skill；具体写入仍由工具执行点与 Policy 检查。';
}

function buildDesignPreflightProjectContext(context: AgentContext) {
    const projectContext = context.projectContext || {};
    return {
        ...projectContext,
        projectImageCount: Number(projectContext.projectImageCount || 0),
        attachmentImageCount: countContextImageInputs(context)
    };
}

async function prepareAgentDesignExecutionPreflight(
    context: AgentContext,
    options: {
        skillId: string;
        params: Record<string, any>;
        routeSource: AgentRequestRouteSource;
        route?: AgentRequestRoute;
        mode?: string;
        intentSummary?: string;
        callModel?: ProcessOptions['callModel'];
        callbacks?: ProcessOptions['callbacks'];
    }
): Promise<{
    params: Record<string, any>;
    preflight?: AgentDesignExecutionPreflight;
}> {
    if (!shouldApplyAgentDesignExecutionPreflight(options.skillId)) {
        return { params: options.params };
    }

    const sharedDefaultsMode = options.mode === 'execute' || options.mode === 'inspect'
        ? options.mode
        : undefined;
    let params = applySharedSkillParamDefaults({
        skillId: options.skillId,
        userInput: context.userInput,
        mode: sharedDefaultsMode,
        params: options.params || {}
    });
    let preflight = buildAgentDesignExecutionPreflight({
        userText: context.userInput,
        route: options.route || 'skill_execution',
        routeSource: options.routeSource,
        skillId: options.skillId,
        mode: options.mode,
        params,
        projectContext: buildDesignPreflightProjectContext(context)
    });

    if (preflight.status === 'needs_model_design_decision' && options.callModel) {
        options.callbacks?.onStep?.({
            kind: 'model_request',
            title: '设计执行前规划',
            detail: '请求模型补充目标、层级、配色、修图、选图和验收标准，供当前 Skill 继续规划。',
            status: 'running',
            percent: 30
        });
        const agentDecision = await requestModelDesignIntelligenceDecision(
            context,
            {
                skillId: options.skillId,
                params,
                intentSummary: options.intentSummary,
                routeSource: options.routeSource
            },
            options.callModel
        );
        if (agentDecision) {
            params = {
                ...params,
                designIntelligenceDecision: agentDecision
            };
            preflight = buildAgentDesignExecutionPreflight({
                userText: context.userInput,
                route: options.route || 'skill_execution',
                routeSource: options.routeSource,
                skillId: options.skillId,
                mode: options.mode,
                params,
                projectContext: buildDesignPreflightProjectContext(context),
                agentDecision
            });
        }
    }

    options.callbacks?.onStep?.({
        kind: preflight.status === 'context_ready' || preflight.status === 'not_applicable'
            ? 'tool_planned'
            : 'model_response',
        title: preflight.status === 'context_ready' || preflight.status === 'not_applicable'
            ? '设计上下文已整理'
            : '设计上下文待补充',
        detail: buildDesignPreflightContextMessage(preflight),
        status: 'success',
        percent: 31
    });

    return { params, preflight };
}

async function executeSkillWithLifecycle(
    context: AgentContext,
    options: {
        skillId: string;
        params: Record<string, any>;
        callbacks: ProcessOptions['callbacks'];
        signal: ProcessOptions['signal'];
        routeSource: AgentRequestRouteSource;
        route?: AgentRequestRoute;
        executionKind?: AgentRequestExecutionKind;
        mode?: string;
        intentSummary?: string;
        reason: string;
        agentDesignExecutionPreflight?: AgentDesignExecutionPreflight;
        intentControlPlane?: AgentIntentControlPlaneDecision;
        callModel?: ProcessOptions['callModel'];
        warnings?: string[];
        observations?: Array<{ source: string; summary: string }>;
    }
): Promise<AgentResult> {
    const lifecycle = buildLifecycle(context, {
        routeSource: options.routeSource,
        route: options.route || 'skill_execution',
        skillId: options.skillId,
        mode: options.mode,
        skillParams: options.params,
        intentSummary: options.intentSummary,
        reason: options.reason,
        executionKind: options.executionKind || 'deterministic_skill',
        warnings: options.warnings,
        observations: options.observations
    });
    // approveGeneratedPublicPlan 是显式选择的受控执行模式，因此强制生成能力中立 public-plan。
    // 普通 autonomous 请求是否直进循环由 executionAuthorization 决定，不再依赖设计品类信号。
    const shouldRunGeneratedPublicPlan = context.agentTaskPublicPlanApproval?.approveGeneratedPublicPlan === true;
    const hasApprovedPublicPlan = context.agentTaskPublicPlanApproval?.userConfirmed === true
        && !shouldRunGeneratedPublicPlan;
    const planning = buildAgentTaskPlanForLifecycle(
        lifecycle,
        options.intentControlPlane,
        shouldRunGeneratedPublicPlan
    );
    // Photoshop 未连接时对「需要 Photoshop 的任务」一律诚实前置失败：不进循环、不生成
    // 「让我检查一下文档状态」这类承诺动作却什么都做不了的漂亮话（真机：PS 断连时详情页任务
    // 连答两轮"我先检查一下"、零执行）。做不到就直说做不到，并指出用户该做什么。
    // 只拦「未连接」这一种确定性阻断；「已连接但没有打开文档」不在此拦——从零设计本就应当
    // 先建画布（见 R2 空画布起点修复），仍按原有 deterministic_skill + read_only 条件处理。
    const blockedByPhotoshopDisconnected = lifecycle.execution.requiresPhotoshop
        && lifecycle.context.photoshopConnected === false;
    if (
        blockedByPhotoshopDisconnected
        || (
            lifecycle.execution.kind === 'deterministic_skill'
            && planning.intentControlPlane.toolScope === 'read_only'
            && lifecycle.execution.requiresPhotoshop
            && lifecycle.execution.canStart === false
        )
    ) {
        const status = lifecycle.context.photoshopConnected
            ? 'blocked_missing_document'
            : 'blocked_missing_photoshop_connection';
        const message = getInternalAgentStatusPublicMessage(status)
            || (lifecycle.context.photoshopConnected
                ? '需要先打开要检查的 Photoshop 文档；本轮没有调用画布工具。'
                : 'Photoshop 当前未连接；本轮没有调用画布工具。');
        options.callbacks?.onStep?.({
            kind: 'verification',
            title: status === 'blocked_missing_photoshop_connection'
                ? 'Photoshop 还没连上'
                : '当前无法读取画布',
            detail: message,
            status: 'error',
            issue: status
        });
        return attachLifecycle(
            withAssistantReplyOrigin(
                {
                    success: false,
                    message,
                    error: status
                },
                deterministicBlockerReplyOrigin(`lifecycle:${status}`)
            ),
            lifecycle,
            planning.intentControlPlane,
            planning.agentTaskPlan
        );
    }
    const allowConfirmedAutonomousRuntime = !shouldRunGeneratedPublicPlan
        && isConfirmedAutonomousTask(planning.intentControlPlane, options.skillId);
    // ready_for_model_planning 只描述 Agent 需要在当前 ReAct 循环内形成路径，不是审批状态。
    // 弱授权请求可以进入循环读取、推理或追问；写入仍由 intent control plane 与执行点 HITL 拦截。
    const allowSameRunAutonomousModelPlanning = !shouldRunGeneratedPublicPlan
        && options.skillId === 'autonomous-agent'
        && planning.agentTaskPlan.status === 'ready_for_model_planning'
        && planning.agentTaskPlan.executionPlan.requiresUserApproval === false;
    // 用户已确认公开计划的接回执行不再二次卡计划门禁——否则批准→接回→再出新计划
    // 形成确认死循环；受控约束由批准白名单与运行时执行点契约继续保证。
    if (shouldBlockExecutionByAgentTaskPlan(planning.agentTaskPlan)
        && !allowConfirmedAutonomousRuntime
        && !allowSameRunAutonomousModelPlanning
        && !hasApprovedPublicPlan) {
        if (
            planning.agentTaskPlan.status === 'ready_for_model_planning'
            && planning.agentTaskPlan.executionPlan.requiresUserApproval === true
            && options.callModel
        ) {
            const readonlyContext = await buildAgentTaskPublicPlanReadonlyContext({
                readonlyToolHandlers: context.resumeReadonlyToolHandlers
            });
            let publicPlanDraft: AgentTaskPublicPlanDraft | null;
            try {
                publicPlanDraft = await requestAgentTaskPublicPlan(
                    context,
                    planning.agentTaskPlan,
                    lifecycle,
                    readonlyContext,
                    options.callModel,
                    options.callbacks,
                    options.signal
                );
            } catch (error) {
                if (isAgentTaskPublicPlanAbortError(error, options.signal)) throw error;
                if (!(error instanceof AgentTaskPublicPlanModelUnavailableError)) throw error;
                const message = '模型服务暂时未能生成设计方案，本轮没有修改 Photoshop。请重试；如果仍失败，请检查模型连接或切换可用模型。';
                options.callbacks?.onStatus?.('模型服务暂时不可用，本轮未改动画面。');
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message,
                            error: 'agent_task_public_plan_model_unavailable',
                            data: {
                                agentTaskPlan: planning.agentTaskPlan,
                                agentTaskPublicPlanReadonlyContext: readonlyContext,
                                agentTaskPublicPlanFailure: {
                                    kind: 'model_call_failed',
                                    attemptedModelCandidates: 3,
                                    photoshopModified: false
                                }
                            }
                        },
                        uiStatusReplyOrigin('agent-task-public-plan:model-call-failed')
                    ),
                    lifecycle,
                    planning.intentControlPlane,
                    planning.agentTaskPlan
                );
            }
            if (publicPlanDraft) {
                    const { publicPlan, runtimeOperationRequests } = publicPlanDraft;
                    const publicPlanExecutionRequest = buildAgentTaskPublicPlanExecutionRequest({
                    agentTaskPlan: planning.agentTaskPlan,
                    designDimensionSpec: context.designDimensionSpec,
                    publicPlan,
                    runtimeAllowedWriteTools: context.agentTaskPublicPlanApproval?.allowedWriteTools
                        || [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST],
                    userConfirmed: context.agentTaskPublicPlanApproval?.userConfirmed,
                    enableControlledExecutionRequest: context.agentTaskPublicPlanApproval?.enableControlledExecutionRequest,
                    requestId: context.agentTaskPublicPlanApproval?.requestId,
                    runtimeOperationRequests: context.agentTaskPublicPlanApproval?.runtimeOperationRequests
                        || runtimeOperationRequests
                });
                const generatedPublicPlanRun = await runGeneratedPublicPlanIfApproved({
                    context,
                    planning,
                    lifecycle,
                    publicPlan,
                    executionRequest: publicPlanExecutionRequest,
                    repairSkillId: options.skillId,
                    repairParams: options.params,
                    signal: options.signal,
                    callbacks: options.callbacks,
                    callModel: options.callModel
                });
                if (generatedPublicPlanRun) return generatedPublicPlanRun;
                return attachLifecycle(
                    {
                        success: true,
                        message: publicPlan.message,
                        data: {
                            agentTaskPlan: planning.agentTaskPlan,
                            agentTaskPublicPlan: publicPlan,
                            agentTaskPublicPlanReadonlyContext: readonlyContext,
                            agentTaskPublicPlanExecutionRequest: publicPlanExecutionRequest
                        }
                    },
                    lifecycle,
                    planning.intentControlPlane,
                    planning.agentTaskPlan
                );
            }
            if (isExplicitProjectContextAutonomousDeliveryFallback(context, planning.agentTaskPlan, options.skillId)) {
                options.callbacks?.onStep?.({
                    kind: 'model_response',
                    title: '改为边做边检查',
                    detail: '多轮方案没有稳定通过画面创建检查，改由 Agent 在受控范围内边处理边复核。',
                    status: 'running',
                    percent: 30
                });
                options.callbacks?.onStatus?.('公开方案没有稳定通过，改由 Agent 边处理边复核。');
                const fallbackResult = await executeSkillWithExecutor(options.skillId, {
                    params: options.params,
                    callbacks: options.callbacks,
                    signal: options.signal,
                    context,
                    agentTaskPlan: planning.agentTaskPlan
                });
                const fallbackResultWithOrigin = await mediateSkillResultUserReplyWithModel({
                    result: fallbackResult,
                    skillId: options.skillId,
                    context,
                    callModel: options.callModel
                });
                const fallbackResultWithObservation = attachAgentReActObservation(
                    fallbackResultWithOrigin,
                    buildAgentReActObservationFromSkillResult({
                        skillId: options.skillId,
                        result: fallbackResultWithOrigin
                    })
                );
                return attachAgentDesignExecutionPreflight(
                    attachLifecycle(
                        fallbackResultWithObservation,
                        lifecycle,
                        planning.intentControlPlane,
                        planning.agentTaskPlan
                    ),
                    options.agentDesignExecutionPreflight
                );
            }
        }
        return attachLifecycle(
            buildAgentTaskPlanBlockedResult(planning.agentTaskPlan, options.callbacks),
            lifecycle,
            planning.intentControlPlane,
            planning.agentTaskPlan
        );
    }
    const result = await executeSkillWithExecutor(options.skillId, {
        params: options.params,
        callbacks: options.callbacks,
        signal: options.signal,
        context,
        agentTaskPlan: planning.agentTaskPlan
    });
    const resultWithOrigin = await mediateSkillResultUserReplyWithModel({
        result,
        skillId: options.skillId,
        context,
        callModel: options.callModel
    });
    const resultWithObservation = attachAgentReActObservation(
        resultWithOrigin,
        buildAgentReActObservationFromSkillResult({
            skillId: options.skillId,
            result: resultWithOrigin
        })
    );
    return attachAgentDesignExecutionPreflight(
        attachLifecycle(
            resultWithObservation,
            lifecycle,
            planning.intentControlPlane,
            planning.agentTaskPlan
        ),
        options.agentDesignExecutionPreflight
    );
}

async function executeSkillWithDesignPreflight(
    context: AgentContext,
    options: Parameters<typeof executeSkillWithLifecycle>[1] & {
        callModel?: ProcessOptions['callModel'];
        intentControlPlane?: AgentIntentControlPlaneDecision;
        mode?: string;
    }
): Promise<AgentResult> {
    const sanitizedParams = sanitizeControlledSkuExecutionParams(context, options.skillId, options.params);
    const sanitizedMode = sanitizeControlledSkuExecutionMode(context, options.skillId, options.mode);
    const prepared = await prepareAgentDesignExecutionPreflight(context, {
        skillId: options.skillId,
        params: sanitizedParams,
        routeSource: options.routeSource,
        route: options.route || 'skill_execution',
        mode: sanitizedMode,
        intentSummary: options.intentSummary,
        callModel: options.callModel,
        callbacks: options.callbacks
    });

    return executeSkillWithLifecycle(context, {
        ...options,
        mode: sanitizedMode,
        params: prepared.params,
        warnings: [
            ...(options.warnings || []),
            ...(prepared.preflight?.warnings || [])
        ],
        observations: [
            ...(options.observations || []),
            ...(prepared.preflight ? [{
                source: 'agent-design-execution-preflight',
                summary: `status=${prepared.preflight.status}; skill=${options.skillId}`
            }] : [])
        ],
        agentDesignExecutionPreflight: prepared.preflight
    });
}

export class DesignAgentEngine {
    async run(context: AgentContext, options: ProcessOptions): Promise<AgentResult> {
        const { callModel, callbacks, signal } = options;

        // ═══════════════════════════════════════════════════════════════
        // Routing Decision Tree (14 branches, first match wins)
        //   1. System cancel
        //   2. Matting pause guard
        //   3. Public plan approval (user confirmed → controlled run)
        //   4. Actionable followup (context rewrite, no return)
        //   5. No model available → runWithoutModel
        //   6. Clarification followup (user asks about previous clarification)
        //   7. Intent control plane requires clarification
        //   8. Conversational path (no tools needed)
        //   9. Deterministic route: metadata-only project inventory
        //  10. Deterministic route: high-confidence before router model
        //  11. Model routing: classifyActionableIntent
        //  12. Model non-execution + deterministic protection
        //  13. Model skill execution
        //  14. Fallback: autonomous agent skill
        // ═══════════════════════════════════════════════════════════════

        // ── Route 1: System cancel ──
        if (signal?.aborted) {
            callbacks?.onStep?.({
                kind: 'stopped',
                title: '任务已取消',
                status: 'error',
                issue: 'cancelled'
            });
            return attachLifecycle(
                withAssistantReplyOrigin(
                    { success: false, cancelled: true, message: '任务已取消。' },
                    uiStatusReplyOrigin('system:cancelled')
                ),
                buildLifecycle(context, {
                    routeSource: 'system',
                    route: 'cancelled',
                    reason: '用户或系统取消了本次请求。'
                })
            );
        }

        // ── Route 2: persisted interactive continuation ──
        // 卡片确认不是一条新自然语言任务。它只能续接操作账本中冻结的精确 Skill 操作，
        // 因此不经过意图分类、路由模型或 Capability 重发现；Skill 注册表的业务预检仍会重新执行。
        if (context.interactiveContinuationRequest) {
            const request = context.interactiveContinuationRequest;
            const continuationOperationIdentity = {
                ...request,
                ...(context.conversationId ? { conversationId: context.conversationId } : {}),
                ...(context.projectContext?.projectId
                    ? { projectId: context.projectContext.projectId }
                    : {}),
                ...(context.projectContext?.projectPath
                    ? { projectPath: context.projectContext.projectPath }
                    : {})
            };
            const ledgerResult = await getInteractiveContinuationOperation(request.continuationId);
            if (!ledgerResult.record?.submission || !ledgerResult.record.continuation) {
                const message = ledgerResult.message || '确认操作没有可恢复的持久化记录，本轮不会写入 Photoshop。';
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message,
                            error: ledgerResult.code || 'interactive_continuation_operation_missing'
                        },
                        deterministicBlockerReplyOrigin('interactive-continuation:ledger-missing')
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary: '交互确认操作缺少可恢复记录。',
                        reason: '持久化操作账本没有返回完整 continuation envelope。',
                        executionKind: 'none',
                        blockers: [message]
                    })
                );
            }
            const expectedPhotoshopDocumentId = Number(
                ledgerResult.record.continuation.scope.photoshopDocumentId || 0
            );
            const freshPhotoshopContext = expectedPhotoshopDocumentId > 0
                ? await getPhotoshopContext({ signal })
                : undefined;
            const currentPhotoshopDocumentId = freshPhotoshopContext?.hasDocument
                ? freshPhotoshopContext.documentId
                : undefined;
            const resolution = resolveInteractiveContinuationOperationRequest({
                continuation: ledgerResult.record.continuation,
                submission: ledgerResult.record.submission,
                request,
                conversationId: context.conversationId,
                projectId: context.projectContext?.projectId,
                projectPath: context.projectContext?.projectPath,
                photoshopDocumentId: currentPhotoshopDocumentId
            });
            if (resolution.status === 'rejected') {
                const message = [
                    resolution.message,
                    '确认操作尚未取得执行权，卡片会保留；恢复原对话、项目和 Photoshop 文档后可以再次确认。'
                ].join('\n');
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message,
                            error: resolution.code
                        },
                        deterministicBlockerReplyOrigin('interactive-continuation:rejected')
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary: '交互确认续跑校验未通过。',
                        reason: '账本 envelope、卡片提交、Photoshop 文档或项目作用域不匹配。',
                        executionKind: 'none',
                        blockers: [message]
                    })
                );
            }

            callbacks?.onStep?.({
                kind: 'observation',
                title: '已承接确认内容',
                detail: '正在继续原挂起操作，不会重新理解或重新生成方案。',
                status: 'success',
                percent: 8,
                source: 'agent_runtime',
                audience: 'user',
                visibility: 'user_process'
            });
            const continuationExecutionRunId = buildInteractiveContinuationExecutionRunId(
                context.requestId,
                request.continuationId
            );
            const beginResult = await beginInteractiveContinuationOperation({
                ...continuationOperationIdentity,
                executionRunId: continuationExecutionRunId
            });
            if (!beginResult.success) {
                const message = beginResult.message || '确认操作没有取得唯一执行权，本轮不会写入 Photoshop。';
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message,
                            error: beginResult.code || 'interactive_continuation_operation_begin_failed'
                        },
                        deterministicBlockerReplyOrigin('interactive-continuation:ledger-begin-rejected')
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary: '交互确认操作未取得唯一执行权。',
                        reason: '持久化操作账本拒绝了重复、冲突或不确定状态。',
                        executionKind: 'none',
                        blockers: [message]
                    })
                );
            }
            let result: any;
            try {
                result = await executeSkillTool(resolution.skillId, resolution.params, {
                    callbacks,
                    signal,
                    context,
                    agentTaskPlan: resolution.agentTaskPlan as AgentTaskPlanningContract | undefined
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error || '执行异常');
                const settlement = await settleInteractiveContinuationOperation({
                    ...continuationOperationIdentity,
                    status: 'failed',
                    mutationState: 'unknown',
                    executionRunId: continuationExecutionRunId,
                    summary: errorMessage
                });
                if (!settlement.success) {
                    throw new Error(`${errorMessage}；${settlement.message}`);
                }
                if (settlement.record?.status === 'unknown') {
                    throw new Error(`${errorMessage}；${settlement.message}`);
                }
                throw error;
            }
            const continuationMutationState = resolveInteractiveContinuationMutationState(result);
            const settlement = await settleInteractiveContinuationOperation({
                ...continuationOperationIdentity,
                status: result.success === true ? 'succeeded' : 'failed',
                mutationState: continuationMutationState,
                executionRunId: continuationExecutionRunId,
                summary: result.success === true
                    ? String(result.message || result.skillOutcome?.status || '执行完成')
                    : String(result.error || result.message || '执行失败')
            });
            if (!settlement.success) {
                const message = buildInteractiveContinuationSettlementFailureMessage(
                    continuationMutationState,
                    settlement.message,
                    result.success === true
                );
                const settlementFailureStatus = continuationMutationState === 'none'
                    ? 'failed'
                    : 'unknown';
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        {
                            success: false,
                            message,
                            error: settlement.code,
                            data: {
                                interactiveContinuationResolution: {
                                    version: 'interactive-continuation-resolution/v0',
                                    continuationId: resolution.continuation.id,
                                    sourceMessageId: resolution.sourceMessageId,
                                    cardId: resolution.submission.cardId,
                                    status: settlementFailureStatus
                                }
                            }
                        },
                        deterministicBlockerReplyOrigin(
                            continuationMutationState === 'none'
                                ? 'interactive-continuation:ledger-settlement-failed-without-mutation'
                                : 'interactive-continuation:ledger-settlement-unknown'
                        )
                    ),
                    buildLifecycle(context, {
                        routeSource: 'intent_control_plane',
                        route: 'direct_response',
                        intentSummary: continuationMutationState === 'none'
                            ? '交互确认操作失败且没有产生 Photoshop 修改，但账本未完成结算。'
                            : '交互确认操作结算状态不确定。',
                        reason: continuationMutationState === 'none'
                            ? '运行结果已明确报告零修改；仅持久化结算失败，不得描述为 Photoshop 已开始后异常。'
                            : '执行结果与持久化账本未能原子收敛，禁止自动重放。',
                        executionKind: 'none',
                        blockers: [message]
                    })
                );
            }
            const resultData = result.data && typeof result.data === 'object'
                ? result.data
                : {};
            let continuationExecutionStatus: 'awaiting_confirmation' | 'executed' | 'failed' | 'unknown' = 'failed';
            if (settlement.record?.status === 'unknown') {
                continuationExecutionStatus = 'unknown';
            } else if (result.skillOutcome?.status === 'awaiting_confirmation') {
                continuationExecutionStatus = 'awaiting_confirmation';
            } else if (result.success === true) {
                continuationExecutionStatus = 'executed';
            }
            return attachLifecycle(
                {
                    ...result,
                    data: {
                        ...resultData,
                        interactiveContinuationResolution: {
                            version: 'interactive-continuation-resolution/v0',
                            continuationId: resolution.continuation.id,
                            sourceMessageId: resolution.sourceMessageId,
                            cardId: resolution.submission.cardId,
                            status: continuationExecutionStatus
                        }
                    }
                },
                buildLifecycle(context, {
                    routeSource: 'intent_control_plane',
                    route: 'skill_execution',
                    skillId: resolution.skillId,
                    intentSummary: '继续执行用户刚确认的原挂起操作。',
                    reason: '操作账本中的一次性 continuation 已通过作用域和卡片绑定校验。',
                    executionKind: 'deterministic_skill',
                    observations: [{
                        source: 'interactive_continuation',
                        summary: `continuation=${resolution.continuation.id}; card=${resolution.submission.cardId}`
                    }]
                })
            );
        }

        // ── Route 3: Matting pause guard ──
        if (isAgentMattingPaused() && isMatteIntent(context.userInput)) {
            const message = getAgentMattingPausedMessage();
            return attachLifecycle(
                withAssistantReplyOrigin(
                    {
                        success: false,
                        message,
                        error: 'Agent matting paused'
                    },
                    uiStatusReplyOrigin('system:matting-paused')
                ),
                buildLifecycle(context, {
                    routeSource: 'system',
                    route: 'direct_response',
                    skillId: 'matte-product',
                    intentSummary: '用户请求抠图，但 Agent 对话端抠图入口已暂停。',
                    reason: '抠图质量和性能尚未完成验收，暂不允许 Agent 自动触发抠图工具。',
                    executionKind: 'none',
                    blockers: [message]
                })
            );
        }

        // ── Route 3: Public plan approval (user confirmed → controlled run) ──
        const publicPlanApprovalRecord = buildAgentTaskPublicPlanApprovalRecord({
            userInput: context.userInput,
            conversationHistory: context.conversationHistory as unknown as Array<Record<string, unknown>>,
            sourceMessageId: context.agentTaskPublicPlanApproval?.sourceMessageId
        });
        if (publicPlanApprovalRecord.requested) {
            const lifecycle = buildLifecycle(context, {
                routeSource: 'lightweight_intent',
                route: 'direct_response',
                intentSummary: '用户确认上一轮公开设计计划，系统只生成待处理请求包。',
                reason: '公开计划确认必须先落到可审计请求包，不能直接执行 Photoshop 写工具。',
                executionKind: 'none'
            });

            if (publicPlanApprovalRecord.status !== 'approved_controlled_execution_request') {
                return attachLifecycle(
                    {
                        success: false,
                        message: publicPlanApprovalRecord.blockers.join('；') || '没有可确认的公开计划请求。',
                        error: publicPlanApprovalRecord.status,
                        data: {
                            agentTaskPublicPlanApprovalRecord: publicPlanApprovalRecord
                        }
                    },
                    lifecycle
                );
            }

            const publicPlanExecutionRequest = buildAgentTaskPublicPlanExecutionRequest({
                agentTaskPlan: publicPlanApprovalRecord.agentTaskPlan,
                designDimensionSpec: context.designDimensionSpec,
                publicPlan: publicPlanApprovalRecord.agentTaskPublicPlan,
                runtimeAllowedWriteTools: context.agentTaskPublicPlanApproval?.allowedWriteTools
                    || publicPlanApprovalRecord.allowedWriteTools,
                userConfirmed: context.agentTaskPublicPlanApproval?.userConfirmed ?? publicPlanApprovalRecord.userConfirmed,
                enableControlledExecutionRequest: context.agentTaskPublicPlanApproval?.enableControlledExecutionRequest
                    ?? publicPlanApprovalRecord.enableControlledExecutionRequest,
                requestId: context.agentTaskPublicPlanApproval?.requestId || publicPlanApprovalRecord.requestId,
                runtimeOperationRequests: context.agentTaskPublicPlanApproval?.runtimeOperationRequests
            });
            callbacks?.onStep?.({
                kind: 'observation',
                title: '准备按方案处理',
                detail: publicPlanApprovalRecord.agentTaskPublicPlan?.executionPlanSummary
                    || publicPlanApprovalRecord.agentTaskPublicPlan?.message
                    || '先按已确认的阶段目标处理画面，完成后再看真实结果。',
                status: 'success',
                percent: 32
            });
            const publicPlanControlledRun = await runAgentTaskPublicPlanControlledRunnerAsync({
                request: publicPlanExecutionRequest,
                executionTarget: context.agentTaskPublicPlanApproval?.executionTarget,
                allowPhotoshopWrites: context.agentTaskPublicPlanApproval?.allowPhotoshopWrites,
                liveExecutionScope: context.agentTaskPublicPlanApproval?.liveExecutionScope,
                explicitProjectWriteApproval: context.agentTaskPublicPlanApproval?.explicitProjectWriteApproval,
                adapter: context.agentTaskPublicPlanApproval?.adapter
            });

            emitControlledRunVisibleReview(callbacks, publicPlanControlledRun);

            // 确认范围内处理失败时，回到 Agent ReAct + Reflexion，而不是直接返回"缺少关键信息"。
            // 确认范围内处理流程是确定性 for 循环，失败即停（controlled-runner.ts:1212），
            // 没有 ReAct 的观察/换路能力，也没有 Reflexion 的重跑能力。
            // 回退后 Agent 在 ReAct 循环中观察失败、决定换路；Agent 失败后走 Reflexion 回路。
            if (shouldRecoverFromPublicPlanControlledRunFailure(publicPlanControlledRun)) {
                const recoveryTask = buildControlledRunFailureRecoveryTask(
                    publicPlanApprovalRecord,
                    publicPlanControlledRun,
                    {
                        liveExecutionScope: context.agentTaskPublicPlanApproval?.liveExecutionScope,
                        explicitProjectWriteApproval: context.agentTaskPublicPlanApproval?.explicitProjectWriteApproval
                    }
                );
                callbacks?.onStep?.({
                    kind: 'observation',
                    title: '确认范围内处理未完成，转入 Agent 自主恢复',
                    detail: `已确认计划的处理失败（${publicPlanControlledRun.blockers.join('；')}），转入 Agent ReAct 循环观察失败并换路重试。`,
                    status: 'running',
                    percent: 35,
                    source: 'agent_runtime',
                    audience: 'user',
                    visibility: 'user_process'
                });
                const autonomousDecision = buildAutonomousExecutionDecisionForEngine(
                    '已确认计划的处理失败，转入 Agent 自主恢复；Agent 应在失败的操作上换路重试，不要重新规划整个任务。'
                );
                return executeSkillWithLifecycle(context, {
                    skillId: 'autonomous-agent',
                    params: {
                        ...buildAutonomousSkillParams(context, undefined, autonomousDecision),
                        userTask: recoveryTask
                    },
                    callbacks,
                    signal,
                    routeSource: 'intent_control_plane',
                    route: 'autonomous_agent',
                    executionKind: 'autonomous_agent',
                    intentSummary: '确认范围内处理失败后转入 Agent 自主恢复。',
                    reason: '已确认计划的处理在写入操作上失败，转入 Agent ReAct 循环观察失败并换路重试；Agent 失败后走 Reflexion 回路。',
                    callModel,
                    intentControlPlane: autonomousDecision
                });
            }

            return attachLifecycle(
                buildPublicPlanControlledRunResult({
                    approvalRecord: publicPlanApprovalRecord,
                    executionRequest: publicPlanExecutionRequest,
                    controlledRun: publicPlanControlledRun
                }),
                buildLifecycle(context, {
                    routeSource: 'intent_control_plane',
                    route: 'skill_execution',
                    skillId: 'autonomous-agent',
                    intentSummary: '按已确认的设计方案处理。',
                    reason: '用户确认设计方案后，已按确认范围处理并复核画面。',
                    executionKind: 'deterministic_skill',
                    blockers: publicPlanControlledRun.blockers,
                    warnings: publicPlanControlledRun.warnings
                })
            );
        }

        // 裸“继续/开始/可以”只进入统一的 resumable-task 对话边界。它不能从自然语言历史
        // 复活一个新的 Photoshop 写任务；卡片与公开计划分别由各自的结构化 continuation owner 接回。
        const intentClassificationInput = context.userInput;

        const operatingPhotoshopConnected = context.operatingContextSnapshot
            ? resolveOperatingPhotoshopConnection(context.operatingContextSnapshot)
            : context.isPluginConnected;
        const operatingPhotoshopHasDocument = context.operatingContextSnapshot
            ? resolveOperatingPhotoshopDocumentPresence(context.operatingContextSnapshot)
            : context.photoshopContext?.hasDocument;
        const intentControlPlane = buildAgentIntentControlPlaneDecision({
            userInput: intentClassificationInput,
            hasImageInput: hasContextImageInput(context),
            hasDocument: operatingPhotoshopHasDocument,
            photoshopConnected: operatingPhotoshopConnected
        });

        // ── Route 5: No model available → runWithoutModel ──
        if (!callModel) {
            return this.runWithoutModel(context, options, intentControlPlane);
        }

        // ── Route 6: Clarification followup (user asks about previous clarification) ──
        // 已批准公开计划的接回执行不走澄清追问分支：上一轮的「公开计划待确认」消息
        // 会被误判为助手澄清，把接回执行整个吞进对话模型（实测确定性复现）。
        const clarificationFollowup = context.agentTaskPublicPlanApproval?.userConfirmed === true
            ? null
            : detectClarificationFollowupContext(context);
        if (clarificationFollowup) {
            callbacks?.onStep?.({
                kind: 'model_response',
                title: '承接澄清上下文',
                detail: '用户正在追问上一轮澄清要求，交给对话模型基于历史生成回答。',
                status: 'success',
                percent: 14
            });
            const conversationalDetailed = await tryConversationalModelReplyDetailed(context, callModel, {
                clarificationFollowup,
                intentControlPlane
            });
            return attachLifecycle(
                conversationalDetailed.reply
                    ? await buildConversationalAgentResult('chat', context, conversationalDetailed.reply, {
                        assistantReplyOrigin: conversationalDetailed.repaired
                            ? modelRepairedReplyOrigin('conversational:clarification-followup')
                            : modelAuthoredReplyOrigin('conversational:clarification-followup')
                    })
                    : buildConversationalUnavailableStatusResult('chat', context, conversationalDetailed.failure),
                buildLifecycle(context, {
                    routeSource: 'lightweight_intent',
                    route: 'direct_response',
                    intentSummary: '用户在追问上一轮澄清要求，需要基于对话历史回答。',
                    reason: conversationalDetailed.reply
                        ? '识别到澄清追问上下文，使用对话模型生成用户可读回答，未进入 Photoshop 执行链。'
                        : '识别到澄清追问上下文，但没有得到有效模型回复，因此不复用固定澄清模板。',
                    executionKind: 'none',
                    observations: [{
                        source: 'conversation-history',
                        summary: 'recent_assistant_clarification_detected'
                    }]
                }),
                intentControlPlane
            );
        }

        const lightweightIntent = detectLightweightIntent(intentClassificationInput, intentControlPlane);
        // ── Route 7: Intent control plane requires clarification ──
        if (intentControlPlane.requiresClarificationBeforeTools) {
            const clarificationDetailed = await tryConversationalModelReplyDetailed(context, callModel, {
                intentControlPlane,
                intentClarification: {
                    requestKind: intentControlPlane.requestKind,
                    userVisibleSummary: intentControlPlane.userVisibleSummary,
                    reason: intentControlPlane.reason,
                    matchedSignals: intentControlPlane.matchedSignals
                }
            });
            return attachLifecycle(
                clarificationDetailed.reply
                    ? await buildConversationalAgentResult('chat', context, clarificationDetailed.reply, {
                        assistantReplyOrigin: clarificationDetailed.repaired
                            ? modelRepairedReplyOrigin('conversational:intent-clarification')
                            : modelAuthoredReplyOrigin('conversational:intent-clarification')
                    })
                    : buildConversationalUnavailableStatusResult('chat', context, clarificationDetailed.failure),
                buildLifecycle(context, {
                    routeSource: 'intent_control_plane',
                    route: 'clarification_needed',
                    intentSummary: intentControlPlane.userVisibleSummary,
                    reason: intentControlPlane.reason,
                    executionKind: 'none'
                }),
                intentControlPlane
            );
        }

        // ── Route 8: Conversational path (no tools needed) ──
        if (shouldEnterConversationalRoute({
            requestKind: intentControlPlane.requestKind,
            executionAuthorization: intentControlPlane.executionAuthorization,
            allowsAutonomousExecution: intentControlPlane.allowsAutonomousExecution,
            intentRequestsConversationalPath: intentControlPlane.shouldUseConversationalPath,
            lightweightIntentIsConversational: isModelFirstConversationalIntent(lightweightIntent),
            publicPlanConfirmed: context.agentTaskPublicPlanApproval?.userConfirmed
        })) {
            const conversationalRouteSource: AgentRequestRouteSource = intentControlPlane.requestKind === 'plan_only'
                ? 'intent_control_plane'
                : 'lightweight_intent';
            const conversationalDetailed = await tryConversationalModelReplyDetailed(context, callModel, {
                intentControlPlane
            });
            return attachLifecycle(
                conversationalDetailed.reply
                    ? await buildConversationalAgentResult(lightweightIntent || 'chat', context, conversationalDetailed.reply, {
                        callModel,
                        assistantReplyOrigin: conversationalDetailed.repaired
                            ? modelRepairedReplyOrigin(`conversational:${lightweightIntent || 'chat'}`)
                            : modelAuthoredReplyOrigin(`conversational:${lightweightIntent || 'chat'}`)
                    })
                    : buildConversationalUnavailableStatusResult(lightweightIntent || 'chat', context, conversationalDetailed.failure),
                buildLifecycle(context, {
                    routeSource: conversationalRouteSource,
                    route: 'direct_response',
                    intentSummary: '这是无需 Photoshop 执行的模型对话请求。',
                    reason: conversationalRouteSource === 'intent_control_plane'
                        ? intentControlPlane.reason
                        : `轻量意图识别为 ${lightweightIntent}，交给对话模型回复。`,
                    executionKind: 'none'
                }),
                intentControlPlane
            );
        }

        // ── Route 9: Deterministic route: metadata-only project inventory ──
        const initialDeterministicRoute = buildRetryDeterministicRoute(context)
            || fastDeterministicRoute(intentClassificationInput, {
                hasAttachedImage: hasContextImageInput(context),
                intentControlPlane
            });
        if (initialDeterministicRoute
            && intentControlPlane.allowsDeterministicRoute
            && !isExplicitDelegatedGoalOwnedByAgent(intentControlPlane)
            && isMetadataOnlyProjectInventoryRoute(initialDeterministicRoute.skillId, initialDeterministicRoute.skillParams)) {
            const unavailable = buildSkillUnavailableResult(initialDeterministicRoute.skillId, context.userInput);
            if (unavailable) {
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        unavailable,
                        deterministicBlockerReplyOrigin(`skill:${initialDeterministicRoute.skillId}:unavailable`)
                    ),
                    buildLifecycle(context, {
                        routeSource: 'deterministic_route',
                        route: 'skill_execution',
                        skillId: initialDeterministicRoute.skillId,
                        intentSummary: initialDeterministicRoute.thinking,
                        reason: '项目资源清单是 metadata-only 只读请求，直接读取项目索引，不调用模型路由。'
                    }),
                    intentControlPlane
                );
            }
            callbacks?.onStep?.({
                kind: 'tool_planned',
                title: `选择能力：${initialDeterministicRoute.skillId}`,
                detail: '项目资源清单是 metadata-only 只读请求，直接读取项目索引，不调用模型路由。',
                status: 'success',
                percent: 18
            });
            callbacks?.onProgress?.('读取项目索引', 18);
            return executeSkillWithDesignPreflight(context, {
                skillId: initialDeterministicRoute.skillId,
                params: initialDeterministicRoute.skillParams,
                callbacks,
                signal,
                routeSource: 'deterministic_route',
                intentSummary: initialDeterministicRoute.thinking,
                reason: '项目资源清单是 metadata-only 只读请求，直接读取项目索引，不调用模型路由。',
                callModel,
                intentControlPlane
            });
        }
        const shouldPreviewSimpleRoute = shouldRequestInitialVisibleIntentPreview(initialDeterministicRoute, {
            intentControlPlane,
            hasContextImage: hasContextImageInput(context),
            userInputText: intentClassificationInput
        });
        const visibleIntentPreviewEmitted = shouldPreviewSimpleRoute
            ? await requestInitialVisibleIntentPreview(context, callModel, callbacks)
            : false;

        const deterministicRouteCandidate = buildRetryDeterministicRoute(context)
            || fastDeterministicRoute(intentClassificationInput, {
                hasAttachedImage: hasContextImageInput(context),
                intentControlPlane
            });
        const deterministicRoute = (deterministicRouteCandidate
            && isDeterministicRouteCompatibleWithToolScope(deterministicRouteCandidate, intentControlPlane)
            && !hasExplicitTeamPipelineIntent(intentClassificationInput))
            ? deterministicRouteCandidate
            : hasExplicitTeamPipelineIntent(intentClassificationInput)
                ? null
                : buildReadOnlyInspectFallbackRoute(context, intentControlPlane);

        // ── Route 10: Deterministic route: high-confidence before router model ──
        if (deterministicRoute
            && intentControlPlane.allowsDeterministicRoute
            && !isExplicitDelegatedGoalOwnedByAgent(intentControlPlane)
            && shouldExecuteDeterministicRouteBeforeRouterModel(deterministicRoute, {
                hasVisibleModelReasoning: visibleIntentPreviewEmitted,
                hasContextImage: hasContextImageInput(context),
                userInputText: intentClassificationInput
            })) {
            const unavailable = buildSkillUnavailableResult(deterministicRoute.skillId, context.userInput);
            if (unavailable) {
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        unavailable,
                        deterministicBlockerReplyOrigin(`skill:${deterministicRoute.skillId}:unavailable`)
                    ),
                    buildLifecycle(context, {
                        routeSource: 'deterministic_route',
                        route: 'skill_execution',
                        skillId: deterministicRoute.skillId,
                        intentSummary: deterministicRoute.thinking,
                        reason: '命中高确定性简单操作路由，但能力不可用。'
                    })
                );
            }

            callbacks?.onStep?.({
                kind: 'tool_planned',
                title: `选择能力：${deterministicRoute.skillId}`,
                detail: '命中高确定性简单 Photoshop 操作，跳过隐藏意图分类模型并直接执行；写入安全由执行预检继续约束。',
                status: 'success',
                percent: 24
            });
            callbacks?.onProgress?.('准备执行', 24);
            return executeSkillWithDesignPreflight(context, {
                skillId: deterministicRoute.skillId,
                params: deterministicRoute.skillParams,
                callbacks,
                signal,
                routeSource: 'deterministic_route',
                intentSummary: deterministicRoute.thinking,
                reason: '命中高确定性简单 Photoshop 操作，跳过隐藏意图分类模型并直接执行；写入安全由执行预检继续约束。',
                callModel,
                intentControlPlane
            });
        }

        // ── Route 11: Model routing (classifyActionableIntent) ──
        let modelDecision: Awaited<ReturnType<typeof classifyActionableIntent>> = null;
        if (intentControlPlane.allowsRouterModel) {
            callbacks?.onStep?.({
                kind: 'model_request',
                title: '正在思考',
                detail: '理解您的设计需求，规划处理方案。',
                status: 'running',
                percent: 10,
                source: 'agent_runtime',
                audience: 'user',
                visibility: 'user_process'
            });
            modelDecision = await classifyActionableIntent(context, callModel);
        }

        // 影子对比只记录模型建议与控制面授权语义的分歧，不改变真实路由。
        // confirmed_tool_required 可直进 Agent runtime；candidate_only 仍需公开计划/确认。
        if (intentControlPlane.requestKind === 'autonomous_execution' && modelDecision?.executionApproach) {
            const authorizationApproach: PublicPlanRoutingApproach =
                hasConfirmedToolExecutionAuthorization(intentControlPlane)
                    ? 'direct_loop'
                    : 'public_plan';
            const routingDivergence = recordPublicPlanRoutingDivergence(
                authorizationApproach,
                modelDecision.executionApproach
            );
            if (routingDivergence.divergenceKind === 'model_skips_plan'
                || routingDivergence.divergenceKind === 'model_wants_plan') {
                console.info('[public-plan-routing-shadow]', routingDivergence.divergenceKind, JSON.stringify({
                    authorization: intentControlPlane.executionAuthorization,
                    authorizationApproach,
                    model: modelDecision.executionApproach,
                    userInput: String(context.userInput || '').slice(0, 80)
                }));
            }
        }

        const deterministicNonExecutionProtection = evaluateDeterministicNonExecutionProtectionForContext(
            context,
            deterministicRoute,
            modelDecision,
            intentControlPlane
        );
        const modelDecisionRoute = String(modelDecision?.route || '');
        const isModelNonExecutionRoute = ['direct_response', 'clarification_needed'].includes(modelDecisionRoute);
        const bypassRouterNonExecutionForConfirmedTask =
            shouldBypassRouterNonExecutionForConfirmedAutonomousTask(intentControlPlane, modelDecision);
        const modelSkillExecutionCompatible = isModelSkillExecutionCompatibleWithIntentBoundary(
            context,
            modelDecision,
            intentControlPlane
        );
        const deterministicModelRouteVeto = shouldDeterministicRouteVetoModelSkill(
            context,
            deterministicRoute,
            modelDecision
        );
        const controlledDeterministicRouteRequiresAutonomous = Boolean(
            deterministicRoute
            && shouldEnterAutonomousReActForControlledRoute(
                deterministicRoute.skillId,
                intentControlPlane
            )
        );
        const protectedAutonomousWorkflowConflict = Boolean(
            modelDecision?.route === 'skill_execution'
            && deterministicRoute
            && deterministicModelRouteVeto.allowed
            && controlledDeterministicRouteRequiresAutonomous
        );
        // v3 拓扑：意图控制面已认定输入是只读查看或知识检索时，router 的非执行判定
        // 只是单个轻量模型的猜测，不能否决——转入自主循环，由带完整工具表的模型
        // 自主决定「直接回答」还是「调用工具」。写入类（write_photoshop）不在此列：
        // SKU/主图等业务保护链（领域内澄清、candidate_only 弱授权尊重 router）保持原语义。
        const routerNonExecutionOverruledByToolScope =
            isModelNonExecutionRoute
            && (intentControlPlane.toolScope === 'read_only'
                || intentControlPlane.toolScope === 'knowledge_search'
                || controlledDeterministicRouteRequiresAutonomous
                // 用户已批准公开计划的接回执行：router 再要澄清就是把任务又丢回用户
                // （实测它问「第3屏图层组叫什么」——这该进循环自己 parse 文档找）。
                || context.agentTaskPublicPlanApproval?.userConfirmed === true);
        const modelSelectedWorkflowRequiresAutonomous = Boolean(
            modelDecision?.route === 'skill_execution'
            && modelDecision.skillId
            && isModelDirectExecutionForbiddenSkill(modelDecision.skillId)
        );
        const modelDecisionForAutonomous = (
            bypassRouterNonExecutionForConfirmedTask
            || routerNonExecutionOverruledByToolScope
            || (!modelSkillExecutionCompatible && !modelSelectedWorkflowRequiresAutonomous)
            || protectedAutonomousWorkflowConflict
        )
            ? null
            : modelDecision;
        // 受保护的受控 Skill 可以推翻 router 的泛化非执行回复。Skill handoff 必须以
        // 最终进入 autonomous runtime 的路由事实为准重新解析；否则外层虽然进入 ReAct，
        // CapabilitySession 却看不到已经确认的专业 workflow，只能 broad discovery 空转。
        const runtimeSelectedSkillHandoff = buildRuntimeSelectedSkillHandoffForExecution(
            context.userInput,
            modelDecisionForAutonomous,
            intentControlPlane
        ) || buildControlledRouteSelectedSkillRuntimeHandoff(
            deterministicRoute?.skillId,
            intentControlPlane
        );
        // ── Route 12: Model non-execution + deterministic protection ──
        if (isModelNonExecutionRoute
            && deterministicRoute
            && deterministicNonExecutionProtection.allowed
            && !controlledDeterministicRouteRequiresAutonomous) {
            const unavailable = buildSkillUnavailableResult(deterministicRoute.skillId, context.userInput);
            if (unavailable) {
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        unavailable,
                        deterministicBlockerReplyOrigin(`skill:${deterministicRoute.skillId}:unavailable`)
                    ),
                    buildLifecycle(context, {
                        routeSource: 'deterministic_route',
                        route: 'skill_execution',
                        skillId: deterministicRoute.skillId,
                        intentSummary: deterministicRoute.thinking,
                        reason: deterministicNonExecutionProtection.reason,
                        observations: [{
                            source: 'agent-route-boundary-policy',
                            summary: deterministicNonExecutionProtection.reason
                        }]
                    }),
                    intentControlPlane
                );
            }
            callbacks?.onStep?.({
                kind: 'tool_planned',
                title: `选择能力：${deterministicRoute.skillId}`,
                detail: deterministicNonExecutionProtection.reason,
                status: 'success',
                percent: 28
            });
            callbacks?.onProgress?.('准备执行', 28);
            return executeSkillWithDesignPreflight(context, {
                skillId: deterministicRoute.skillId,
                params: deterministicRoute.skillParams,
                callbacks,
                signal,
                routeSource: 'deterministic_route',
                intentSummary: deterministicRoute.thinking,
                reason: deterministicNonExecutionProtection.reason,
                callModel,
                intentControlPlane,
                observations: [{
                    source: 'agent-route-boundary-policy',
                    summary: deterministicNonExecutionProtection.reason
                }]
            });
        }

        if (!bypassRouterNonExecutionForConfirmedTask
            && !routerNonExecutionOverruledByToolScope
            && modelDecision?.route === 'direct_response'
            && modelDecision.directResponse) {
            const conversationalDetailed = await tryConversationalModelReplyDetailed(context, callModel, {
                intentControlPlane
            });
            return attachLifecycle(
                conversationalDetailed.reply
                    ? await buildConversationalAgentResult('chat', context, conversationalDetailed.reply, {
                        assistantReplyOrigin: conversationalDetailed.repaired
                            ? modelRepairedReplyOrigin('model-router:direct-response')
                            : modelAuthoredReplyOrigin('model-router:direct-response')
                    })
                    : buildConversationalUnavailableStatusResult('chat', context, conversationalDetailed.failure, {
                        error: 'conversational_reply_unavailable'
                    }),
                buildModelDecisionLifecycle(context, modelDecision, '模型路由判断为直接回复；可见文本必须经过对话回复质量门，而不是展示 router 字段。'),
                intentControlPlane
            );
        }

        if (!bypassRouterNonExecutionForConfirmedTask
            && !routerNonExecutionOverruledByToolScope
            && modelDecision?.route === 'clarification_needed'
            && modelDecision.clarificationQuestion) {
            emitIntentStatus(callbacks, resolveIntentSummary(modelDecision));
            const clarificationDetailed = await tryConversationalModelReplyDetailed(context, callModel, {
                intentControlPlane,
                intentClarification: {
                    requestKind: intentControlPlane.requestKind,
                    userVisibleSummary: intentControlPlane.userVisibleSummary,
                    reason: intentControlPlane.reason,
                    matchedSignals: intentControlPlane.matchedSignals
                }
            });
            return attachLifecycle(
                clarificationDetailed.reply
                    ? await buildConversationalAgentResult('chat', context, clarificationDetailed.reply, {
                        assistantReplyOrigin: clarificationDetailed.repaired
                            ? modelRepairedReplyOrigin('model-router:clarification')
                            : modelAuthoredReplyOrigin('model-router:clarification')
                    })
                    : buildConversationalUnavailableStatusResult('chat', context, clarificationDetailed.failure),
                buildModelDecisionLifecycle(context, modelDecision, '模型路由提出当前业务领域内的有效追问，未进入 Photoshop 执行。'),
                intentControlPlane
            );
        }

        // ── Route 13: Model skill execution ──
        if (modelDecision?.route === 'skill_execution'
            && modelDecision.skillId
            && modelSkillExecutionCompatible
            && intentControlPlane.allowsDeterministicRoute
            && !isExplicitDelegatedGoalOwnedByAgent(intentControlPlane)
            && !hasExplicitTeamPipelineIntent(context.userInput)
            && isSkillEnabled(modelDecision.skillId)
            && getSkillExecutor(modelDecision.skillId)) {
            const veto = deterministicModelRouteVeto;
            if (veto.allowed && deterministicRoute && !protectedAutonomousWorkflowConflict) {
                callbacks?.onStep?.({
                    kind: 'tool_planned',
                    title: `选择能力：${deterministicRoute.skillId}`,
                    detail: veto.reason,
                    status: 'success',
                    percent: 28
                });
                callbacks?.onProgress?.('准备执行', 28);
                return executeSkillWithDesignPreflight(context, {
                    skillId: deterministicRoute.skillId,
                    params: deterministicRoute.skillParams,
                    callbacks,
                    signal,
                    routeSource: 'deterministic_route',
                    intentSummary: deterministicRoute.thinking,
                    reason: veto.reason,
                    callModel,
                    intentControlPlane,
                    observations: [{
                        source: 'agent-route-boundary-policy',
                        summary: veto.reason
                    }]
                });
            }

            if (!protectedAutonomousWorkflowConflict
                && canExecuteSkillFromUserRequest(modelDecision.skillId, context.userInput)) {
                callbacks?.onStep?.({
                    kind: 'tool_planned',
                    title: `选择能力：${modelDecision.skillId}`,
                    detail: '模型选择了可执行能力，且当前请求允许进入计划处理。',
                    status: 'success',
                    percent: 28
                });
                callbacks?.onProgress?.('准备执行', 28);
                return executeSkillWithDesignPreflight(context, {
                    skillId: modelDecision.skillId,
                    params: buildSkillParamsFromModelDecision(context, modelDecision),
                    callbacks,
                    signal,
                    routeSource: 'model_router',
                    mode: modelDecision.mode,
                    intentSummary: resolveIntentSummary(modelDecision),
                    reason: deterministicRoute && deterministicRoute.skillId !== normalizeSkillId(modelDecision.skillId)
                        ? '模型选择了不同于本地候选的能力；本地候选仅作为参考，不替代模型判断。'
                        : '模型路由选择确定性技能，且意图控制面允许执行。',
                    callModel,
                    intentControlPlane
                });
            }
        }

        callbacks?.onProgress?.('分析需求', 12);
        if (deterministicRoute
            && intentControlPlane.allowsDeterministicRoute
            && !shouldEnterAutonomousReActForControlledRoute(deterministicRoute.skillId, intentControlPlane)) {
            const unavailable = buildSkillUnavailableResult(deterministicRoute.skillId, context.userInput);
            if (unavailable) {
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        unavailable,
                        deterministicBlockerReplyOrigin(`skill:${deterministicRoute.skillId}:unavailable`)
                    ),
                    buildLifecycle(context, {
                        routeSource: 'deterministic_route',
                        route: 'skill_execution',
                        skillId: deterministicRoute.skillId,
                        intentSummary: deterministicRoute.thinking,
                        reason: '命中确定性路由，但能力不可用。'
                    }),
                    intentControlPlane
                );
            }

            callbacks?.onStep?.({
                kind: 'tool_planned',
                title: `选择能力：${deterministicRoute.skillId}`,
                detail: '命中确定性路由，直接执行对应能力。',
                status: 'success',
                percent: 28
            });
            callbacks?.onProgress?.('准备执行', 28);
            return executeSkillWithDesignPreflight(context, {
                skillId: deterministicRoute.skillId,
                params: deterministicRoute.skillParams,
                callbacks,
                signal,
                routeSource: 'deterministic_route',
                intentSummary: deterministicRoute.thinking,
                reason: '模型路由未覆盖时，使用确定性路由执行对应能力。',
                callModel,
                intentControlPlane
            });
        }

        if (modelDecision?.route === 'autonomous_agent'
            && intentControlPlane.allowsAutonomousExecution) {
            emitIntentStatus(callbacks, resolveIntentSummary(modelDecision));
            const hasExecutionAuthorization = hasConfirmedToolExecutionAuthorization(intentControlPlane);
            const autonomousDecision = buildAutonomousRuntimeDecisionForAgentChoice(
                intentControlPlane,
                hasExecutionAuthorization
                    ? '当前任务已获得工具执行授权；由 Agent 运行时自主选择能力、执行并复核结果。'
                    : '当前任务只有候选执行意图；先形成公开计划和检查目标，不静默升级写入权限。',
                modelDecision
            );
            callbacks?.onStep?.({
                kind: 'model_request',
                title: hasExecutionAuthorization ? '准备处理任务' : '整理设计计划',
                detail: hasExecutionAuthorization
                    ? '任务已获得执行授权，进入 Agent 处理循环；具体能力路径由 Agent 根据上下文决定。'
                    : '当前只有候选执行意图，先整理公开计划、可用处理范围和检查目标。',
                status: 'running',
                percent: 20,
                source: 'agent_runtime',
                audience: 'user',
                visibility: 'user_process'
            });
            callbacks?.onProgress?.(hasExecutionAuthorization ? '准备处理任务' : '整理设计计划', 20);
            return executeSkillWithLifecycle(context, {
                skillId: 'autonomous-agent',
                params: buildAutonomousSkillParams(
                    context,
                    modelDecision,
                    autonomousDecision,
                    runtimeSelectedSkillHandoff
                ),
                callbacks,
                signal,
                routeSource: 'model_router',
                route: 'autonomous_agent',
                executionKind: 'autonomous_agent',
                intentSummary: resolveIntentSummary(modelDecision),
                reason: hasExecutionAuthorization
                    ? '控制面已确认工具执行授权，进入 autonomous runtime；写入仍受执行预检和读回约束。'
                    : '控制面仅给出候选执行授权，进入公开计划阶段且不直接改动画面。',
                callModel,
                intentControlPlane: autonomousDecision
            });
        }

        // ── Route 14: Fallback autonomous agent (public plan gate) ──
        if (intentControlPlane.allowsAutonomousExecution || intentControlPlane.toolScope !== 'none') {
            const authorizedRuntimeFallback =
                bypassRouterNonExecutionForConfirmedTask
                || routerNonExecutionOverruledByToolScope
                || hasConfirmedToolExecutionAuthorization(intentControlPlane);
            // 只播报模型真实产出的意图判断，不再回落到硬编码的 control-plane 路线文案
            // （那是内部路线描述，不是 Agent 的真实思考；已取消固定路线后不应伪装成「正在思考」）。
            emitIntentStatus(callbacks, resolveIntentSummary(modelDecisionForAutonomous));
            callbacks?.onStep?.({
                kind: 'model_request',
                title: authorizedRuntimeFallback ? '准备处理任务' : '整理设计计划',
                detail: authorizedRuntimeFallback
                    ? '任务已获得执行授权，进入 Agent 处理循环并以真实结果为准。'
                    : '当前只有候选执行意图，先由模型形成公开计划、可用处理范围和检查目标。',
                status: 'running',
                percent: 20,
                source: 'agent_runtime',
                audience: 'user',
                visibility: 'user_process'
            });
            callbacks?.onProgress?.(authorizedRuntimeFallback ? '准备处理任务' : '整理设计计划', 20);
            let autonomousDecisionReason: string;
            if (routerNonExecutionOverruledByToolScope) {
                autonomousDecisionReason = '意图控制面认定输入具备工具语义；模型路由的非执行判定不能否决，由带工具表的模型自主决定是否调用工具。';
            } else if (authorizedRuntimeFallback) {
                autonomousDecisionReason = '控制面已确认工具执行授权，进入 Agent runtime 自主观察、选择能力并读回复核。';
            } else if (modelDecisionForAutonomous) {
                autonomousDecisionReason = '控制面只有候选执行意图，模型路由未补足授权；转入公开计划门禁。';
            } else {
                autonomousDecisionReason = '控制面只有候选执行意图，需要先形成公开计划和检查目标。';
            }
            const autonomousDecision = buildAutonomousRuntimeDecisionForAgentChoice(
                intentControlPlane,
                autonomousDecisionReason,
                modelDecisionForAutonomous
            );
            let lifecycleReason: string;
            if (modelDecisionForAutonomous && authorizedRuntimeFallback) {
                lifecycleReason = '控制面已确认执行授权，模型路由不能把任务降级为非执行；进入 autonomous runtime。';
            } else if (modelDecisionForAutonomous) {
                lifecycleReason = '控制面只有候选执行意图；进入公开计划门禁，未直接运行 Photoshop 工具。';
            } else if (authorizedRuntimeFallback) {
                lifecycleReason = '控制面已确认执行授权；进入 autonomous runtime 后由 Agent 自主选择能力并读回复核。';
            } else {
                lifecycleReason = '控制面只有候选执行意图；没有模型路由结果时先进入公开计划门禁。';
            }
            return executeSkillWithLifecycle(context, {
                skillId: 'autonomous-agent',
                params: buildAutonomousSkillParams(
                    context,
                    modelDecisionForAutonomous,
                    autonomousDecision,
                    runtimeSelectedSkillHandoff
                ),
                callbacks,
                signal,
                routeSource: modelDecisionForAutonomous ? 'model_router' : 'intent_control_plane',
                route: 'autonomous_agent',
                executionKind: 'autonomous_agent',
                intentSummary: resolveIntentSummary(modelDecisionForAutonomous) || intentControlPlane.userVisibleSummary,
                reason: lifecycleReason,
                callModel,
                intentControlPlane: autonomousDecision
            });
        }

        emitIntentStatus(callbacks, resolveIntentSummary(modelDecision));
        return attachLifecycle(
            buildConversationalUnavailableStatusResult('chat', context, undefined),
            buildLifecycle(context, {
                routeSource: 'intent_control_plane',
                route: intentControlPlane.requiresClarificationBeforeTools ? 'clarification_needed' : 'direct_response',
                intentSummary: resolveIntentSummary(modelDecision) || intentControlPlane.userVisibleSummary,
                reason: modelDecision
                    ? `${intentControlPlane.reason} 模型路由未达到允许执行的条件。`
                    : `${intentControlPlane.reason} 没有可用模型路由结果。`,
                executionKind: 'none'
            }),
            intentControlPlane
        );
    }

    /**
     * 无可用模型时的显式降级路径：
     * 寒暄类输入用本地回复；命中确定性路由的任务按规则执行（明确标注降级）；
     * 其余如实告知模型不可用，不做关键词猜测执行。
     */
    private async runWithoutModel(
        context: AgentContext,
        options: ProcessOptions,
        intentControlPlane: AgentIntentControlPlaneDecision
    ): Promise<AgentResult> {
        const { callbacks, signal } = options;
        const clarificationFollowup = detectClarificationFollowupContext(context);
        const lightweightIntent = detectLightweightIntent(context.userInput, intentControlPlane);
        const shouldUseConversationalRoute = shouldEnterConversationalRoute({
            requestKind: intentControlPlane.requestKind,
            executionAuthorization: intentControlPlane.executionAuthorization,
            allowsAutonomousExecution: intentControlPlane.allowsAutonomousExecution,
            intentRequestsConversationalPath: intentControlPlane.shouldUseConversationalPath,
            lightweightIntentIsConversational: isModelFirstConversationalIntent(lightweightIntent)
        });
        if (clarificationFollowup || shouldUseConversationalRoute) {
            const route: AgentRequestRoute = intentControlPlane.requiresClarificationBeforeTools
                ? 'clarification_needed'
                : 'direct_response';
            return attachLifecycle(
                buildConversationalUnavailableStatusResult(lightweightIntent || 'chat', context, undefined),
                buildLifecycle(context, {
                    routeSource: intentControlPlane.requestKind === 'plan_only'
                        ? 'intent_control_plane'
                        : 'lightweight_intent',
                    route,
                    intentSummary: clarificationFollowup
                        ? '用户在追问上一轮澄清要求，但当前没有可用模型。'
                        : intentControlPlane.userVisibleSummary,
                    reason: '当前没有可用模型，不能编造本地对话或固定能力菜单。',
                    executionKind: 'none'
                }),
                intentControlPlane
            );
        }

        if (isModelFirstConversationalIntent(lightweightIntent)) {
            const localReply = buildLocalConversationalReply(lightweightIntent, context);
            if (localReply) {
                return attachLifecycle(
                    await buildConversationalAgentResult(lightweightIntent, context, localReply, {
                        assistantReplyOrigin: uiStatusReplyOrigin(`conversational:${lightweightIntent}:local-status`)
                    }),
                    buildLifecycle(context, {
                        routeSource: 'lightweight_intent',
                        route: 'direct_response',
                        intentSummary: '无可用模型，使用本地对话回复。',
                        reason: `降级模式：轻量意图识别为 ${lightweightIntent}，使用本地回复。`
                    })
                );
            }
        }

        if (intentControlPlane.allowsAutonomousExecution) {
            return attachLifecycle(
                buildConversationalUnavailableStatusResult('chat', context, undefined),
                buildLifecycle(context, {
                    routeSource: 'intent_control_plane',
                    route: 'autonomous_agent',
                    intentSummary: intentControlPlane.userVisibleSummary,
                    reason: '当前没有可用模型，不能编造本地设计计划或固定澄清话术。',
                    executionKind: 'none'
                }),
                intentControlPlane
            );
        }

        const route = buildRetryDeterministicRoute(context)
            || fastDeterministicRoute(context.userInput, {
                hasAttachedImage: hasContextImageInput(context),
                intentControlPlane
            });

        if (route) {
            const unavailable = buildSkillUnavailableResult(route.skillId, context.userInput);
            if (unavailable) {
                return attachLifecycle(
                    withAssistantReplyOrigin(
                        unavailable,
                        deterministicBlockerReplyOrigin(`skill:${route.skillId}:unavailable`)
                    ),
                    buildLifecycle(context, {
                        routeSource: 'deterministic_route',
                        route: 'skill_execution',
                        skillId: route.skillId,
                        intentSummary: route.thinking,
                        reason: '降级模式命中确定性路由，但能力不可用。'
                    })
                );
            }
            callbacks?.onStep?.({
                kind: 'tool_planned',
                title: `降级执行：${route.skillId}`,
                detail: '当前没有可用模型，按确定性规则降级执行（规则模式，未经过模型决策）。',
                status: 'success',
                percent: 24
            });
            callbacks?.onProgress?.('按规则执行', 24);
            return executeSkillWithDesignPreflight(context, {
                skillId: route.skillId,
                params: route.skillParams,
                callbacks,
                signal,
                routeSource: 'deterministic_route',
                intentSummary: route.thinking,
                reason: '无可用模型，按确定性规则降级执行。'
            });
        }

        return attachLifecycle(
            buildConversationalUnavailableStatusResult('chat', context, undefined),
            buildLifecycle(context, {
                routeSource: 'system',
                route: 'clarification_needed',
                intentSummary: '无可用模型，且未命中确定性规则。',
                reason: '降级模式下不做关键词猜测执行，如实告知模型不可用。',
                executionKind: 'none'
            })
        );
    }

    debugDecisionFromText(userInput: string) {
        return debugInferDecisionFromText(userInput);
    }
}

function buildInteractiveContinuationSettlementFailureMessage(
    mutationState: InteractiveContinuationMutationState,
    settlementMessage: string,
    businessResultSucceeded: boolean
): string {
    if (mutationState === 'none') {
        return [
            businessResultSucceeded
                ? '业务处理已经返回成功结果，并确认本轮没有产生 Photoshop 修改，但持久化状态没有完成结算。'
                : '业务处理已经返回失败结果，并确认本轮没有产生 Photoshop 修改，但持久化状态没有完成结算。',
            settlementMessage,
            '请不要重复点击这张卡；可以根据原提示重新发起任务。'
        ].filter(Boolean).join('\n');
    }
    return [
        mutationState === 'observed'
            ? '确认操作失败前已经观察到画面或文件修改，但持久化状态没有完成结算。'
            : '确认操作已经返回结果，但缺少可靠的修改统计，且持久化状态没有完成结算。',
        settlementMessage,
        '请先检查 Photoshop 当前画面，不要重复点击这张卡。'
    ].filter(Boolean).join('\n');
}

export const designAgentEngine = new DesignAgentEngine();

export async function processWithUnifiedAgent(
    context: AgentContext,
    options: ProcessOptions
): Promise<AgentResult> {
    return designAgentEngine.run(context, options);
}

export { debugInferDecisionFromText };
