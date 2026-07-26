import type { AgentThinkingEventMeta } from '../../../shared/agent-observation-channels';
import type { AgentIntentControlPlaneDecision } from '../../../shared/agent-intent-control-plane';
import type { AgentTaskPlanningContract } from '../../../shared/agent-task-planning-contract';
import type { AgentTaskPlanPresentation } from '../../../shared/agent-task-plan-presentation';
import type { CurrentDocumentUseMode } from '../../../shared/design-document-role';
import type {
    ReActReflexionLoopContract,
    ReflexionHandoff
} from '../../../shared/agent-runtime-v5/reflexion-contract';
import type { LegacyToolCapabilityBridge } from '../../../shared/agent-runtime-v5/tool-capability-bridge';
import type { RuntimeStagePlan } from '../../../shared/agent-runtime-v5/runtime-stage-plan';
import type { RuntimeStageState } from '../../../shared/agent-runtime-v5/runtime-stage-state';
import type { RuntimeStageTraceDigest } from '../../../shared/agent-runtime-v5/runtime-stage-trace';
import type {
    RuntimeDesignBriefDeclaration,
    RuntimeDesignBriefDigest,
    RuntimeDesignBriefAvailableInputSource
} from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import type {
    RuntimeReferenceBriefDeclaration,
    RuntimeReferenceBriefDigest
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import type {
    RuntimeDesignStrategyDeclaration,
    RuntimeDesignStrategyDigest
} from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';
import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanDigest
} from '../../../shared/agent-runtime-v5/runtime-action-plan-declaration';
import type {
    RuntimePlanningContextSeed,
    RuntimePlanningContextSeedDigest
} from '../../../shared/agent-runtime-v5/runtime-planning-context-seed';
import type { RuntimeActionPlanReconciliationDigest } from '../../../shared/agent-runtime-v5/runtime-action-plan-reconciliation';
import type { RuntimeActionPlanNoRedoShadowDigest } from '../../../shared/agent-runtime-v5/runtime-action-plan-no-redo-shadow';
import type { RuntimeActionPlanResumeFreshness } from '../../../shared/agent-runtime-v5/runtime-action-plan-resume-freshness';
import type {
    RuntimeSession,
    RuntimeSessionDigest,
    RuntimeSessionIdentity
} from '../../../shared/agent-runtime-v5/runtime-session';
import type { RuntimeDeliveryVerification } from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import type { ArtifactRepositoryReadProjection } from '../../../shared/agent-runtime-v5/artifact-repository-contract';
import type { AgentCapabilityResolution } from '../../../shared/agent-runtime-v5/contracts/capability-resolution';
import type {
    DesignEvaluationProfile,
    DesignEvaluationProfileDigest
} from '../../../shared/agent-runtime-v5/design-evaluation-profiles';
import type { ProviderNativeToolRequest } from '../../../shared/provider-native-tools';
import type { DesignScorecard } from '../../../shared/design-quality-assertion';
import type { DesignVerdict } from '../../../shared/design-quality-verdict-bundle';
import type { AgentMessageContextMetadata } from './message-context';

export type { AgentThinkingEventMeta };

export interface ToolSchema {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface ToolResult {
    callId: string;
    success: boolean;
    output: any;
}

export interface ContentBlock {
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mediaType?: string;
}

export interface AgentMessage {
    role: 'system' | 'user' | 'assistant' | 'tool_result';
    content?: string;
    contentBlocks?: ContentBlock[];
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    /**
     * 上一轮 assistant 的原生推理内容（reasoning_content）。思考模式 + 工具调用时，
     * 部分 provider 要求后续轮次原样回传；随 messages 透传到 main 侧 adapter.formatMessages 写回。
     * 仅在 assistant + toolCalls 场景写入，避免污染普通消息。
     */
    reasoningContent?: string;
    /**
     * Renderer 内部的来源、权限与保留策略；Provider adapter 不直接消费该字段。
     * 发送前由 message-context 将非用户消息渲染为显式 runtime envelope。
     */
    contextMetadata?: AgentMessageContextMetadata;
}

export interface ImageAttachment {
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export type AgentStepKind =
    | 'task_started'
    | 'iteration_started'
    | 'model_request'
    | 'model_response'
    | 'tool_planned'
    | 'tool_started'
    | 'tool_completed'
    | 'observation'
    | 'verification'
    | 'warning'
    | 'finalizing'
    | 'stopped';

export type AgentStepSource =
    | 'model'
    | 'agent_runtime'
    | 'skill_executor'
    | 'tool_executor'
    | 'system';

export type AgentStepAudience = 'user' | 'agent' | 'debug';

export interface AgentStepEvent {
    kind: AgentStepKind;
    title: string;
    detail?: string;
    status: 'pending' | 'running' | 'success' | 'error';
    iteration?: number;
    maxIterations?: number;
    toolName?: string;
    toolCallId?: string;
    percent?: number;
    issue?: string;
    /** 谁产生了这条事件。用于区分 Agent 表达、执行器状态和系统诊断。 */
    source?: AgentStepSource;
    /** 这条事件的目标读者。脚本/工具输出默认给 Agent 看，不直接给用户看。 */
    audience?: AgentStepAudience;
    /** 只有运行层主动标记的公开过程事件才允许进入用户可见的判断/观察流。 */
    visibility?: 'user_process';
}

export interface AgentConfig {
    systemPrompt: string;
    tools: ToolSchema[];
    modelId: string;
    maxIterations: number;
    /** Agent 核心执行硬上限；由已选 Skill performance_profile 经全局 ceiling 截断后注入。 */
    performanceBudget?: {
        maxModelCalls: number;
        maxToolCalls: number;
        /** 本轮允许进入模型视觉上下文的候选图像总数。 */
        maxVisionCandidates: number;
        /** 本轮允许真实发起的视觉模型判断次数；多个候选可在一次判断中批量消费。 */
        maxVisualAnalyses: number;
        /** 由执行前策略层使用的原分辨率读取上限；Agent 仅承接有效预算，不自行放宽。 */
        maxFullResolutionImageReads: number;
        softTimeBudgetMs: number;
    };
    requireInitialToolCall?: boolean;
    signal?: AbortSignal;
    taskCompletionContext?: TaskCompletionContext;
    toolDecisionContext?: AgentToolDecisionContext;
    /** 请求级规划真相源；用于判断本轮是否必须产生真实任务进展。 */
    agentTaskPlan?: AgentTaskPlanningContract;
    /** 对话任务计划投影的作用域；只用于防跨会话/跨项目更新，不授予执行权。 */
    taskPlanPresentationScope?: {
        conversationId: string;
        projectId: string;
    };
    runtimeLoopContract?: ReActReflexionLoopContract;
    runtimeStagePlan?: RuntimeStagePlan;
    /** 上游 Harness 已解析出的结构化/项目输入来源；Agent 仅按 Manifest 绑定到 inputKey。 */
    runtimeDesignBriefAvailableInputSources?: readonly RuntimeDesignBriefAvailableInputSource[];
    /** executor 在模型/Tool 执行前签发；同一 Reflexion 链共享 sessionId，generation 单调递增。 */
    runtimeSessionIdentity?: RuntimeSessionIdentity;
    /** Reflexion 新代继承的已推进 Session；必须已切换到新 generation 且尚未 finalize。 */
    runtimeSessionSeed?: RuntimeSession;
    /** 同一活动 Session 内、按回退目标承接的模型规划声明；不得从 Run Record digest 补造。 */
    runtimePlanningContextSeed?: RuntimePlanningContextSeed;
    reflexionHandoff?: ReflexionHandoff;
    toolCapabilityBridge?: LegacyToolCapabilityBridge;
    /** manifest-selected Evaluation Capability；只改变评价标准，不拥有最终 verdict。 */
    evaluationProfile?: DesignEvaluationProfile;
    /** 读取当前 Capability Session 的实时解析结果；仅用于计划校验，不授予权限或自动装载。 */
    getCapabilityResolution?: () => AgentCapabilityResolution;
    /** 只读 Tool→当前已激活 Capability 映射；只用于影子对账，不参与执行授权。 */
    getActiveCapabilityIdsForTool?: (toolName: string) => string[];
    /** 当前 Session 内由模型显式按需激活的 Capability；只扩展 Stage 的模型可见 provider 面。 */
    getOnDemandActivatedCapabilityIds?: () => string[];
    /** 已通过执行器只读探针形成的跨轮新鲜度结果；只开放模型显式映射，不自动跳过节点。 */
    runtimeActionPlanResumeFreshness?: RuntimeActionPlanResumeFreshness;
    /**
     * 主进程 Artifact Repository 的唯一 Harness 适配器。只接收 Agent 内部已验证声明，
     * 发布完成后返回 refs-only 投影；失败不得改变任务结果。
     */
    finalizeRuntimeArtifacts?: (
        input: RuntimeArtifactPublicationInput
    ) => Promise<ArtifactRepositoryReadProjection | undefined>;
    callbacks: AgentCallbacks;
    callModelStream?: CallModelStreamFn;
    /**
     * 视觉槽专家模型 id：当主模型不支持读图时，用它替主模型读取快照并把观察结果注入上下文
     * （强模型主导 + 视觉专家协同）。由调用方按用户的 visualModel 配置注入。
     */
    visualExpertModelId?: string;
    /**
     * 工具循环是否开启原生思考（reasoning_content）。由调用方按用户「模型思考」开关 +
     * 模型能力（isModelThinkingUserControllable）解析注入；agent 透传给 callModel/callModelStream，
     * 最终由 main 侧 adapter 决定是否下发 thinking:{type:'disabled'} 与是否回写 reasoning。
     */
    thinkingEnabled?: boolean;
}

export interface RuntimeArtifactPublicationInput {
    runtimeSession: RuntimeSession;
    runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
    runtimeDesignStrategyDeclaration?: RuntimeDesignStrategyDeclaration;
    runtimeActionPlanDeclaration?: RuntimeActionPlanDeclaration;
    designVerdict?: DesignVerdict;
    runtimeDeliveryVerification?: RuntimeDeliveryVerification;
}

export interface AgentToolDecisionContext {
    intentControlPlane?: AgentIntentControlPlaneDecision;
    photoshopConnected?: boolean;
    hasDocument?: boolean;
    hasImageInput?: boolean;
    /** 当前打开文档是否可复用、只读观察或必须完全避开；由上游用户指令契约确定。 */
    currentDocumentUse?: CurrentDocumentUseMode;
}

export interface AgentCallbacks {
    /** Provider/native thinking or model-authored public reasoning summary. Do not fabricate chain-of-thought. */
    onThinking?: (thinking: string, meta?: AgentThinkingEventMeta) => void;
    /** Structured observable step. Preferred for Pondering/diagnostics UI. */
    onStep?: (step: AgentStepEvent) => void;
    onStatus?: (message: string) => void;
    onToolStart?: (toolName: string) => void;
    onToolComplete?: (toolName: string, result: any) => void;
    onProgress?: (message: string, percent: number) => void;
    onMessage?: (message: string) => void;
    onIterationComplete?: (iteration: number, maxIterations: number) => void;
    /** R4 计划的用户可见步骤状态；只更新展示，不反向改变 Runtime 或任务结果。 */
    onTaskPlanPresentation?: (presentation: AgentTaskPlanPresentation) => void;
    /**
     * Agent 看过的画面快照，转发给用户聊天，让用户看到「Agent 看到的是什么」。
     * 独立于喂给模型的视觉观察；带去重与张数上限以防刷屏。
     */
    onSnapshotImage?: (snapshot: { data: string; mediaType: string; toolName: string; index: number }) => void;
}

export type AgentStopReason =
    | 'final_response'
    | 'tool_budget_final_response'
    | 'tool_preflight_blocked'
    | 'plan_execution_mismatch'
    | 'max_iterations'
    // 性能预算耗尽（模型调用 / 工具调用 / 时间上限）——与「真·迭代耗尽 max_iterations」区分，
    // 让停机原因诚实：此前二者共用 max_iterations，卡片「原因」把预算问题误报成迭代问题。
    | 'performance_budget'
    | 'no_progress'
    | 'empty_final_response'
    | 'awaiting_user_confirmation'
    | 'cancelled'
    | 'error';

export type AgentExecutionStatus =
    | 'completed'
    | 'needs_review'
    | 'failed'
    | 'cancelled'
    // 停在用户确认点（已创建交互确认卡片，等待用户确认/编辑后续跑）是正常暂停，
    // 不是失败/未完成——独立状态，避免被压扁进 failed 桶导致 UI 显示红色"未完成"。
    | 'awaiting_confirmation';

export type AgentToolCallOrigin =
    | 'model_tool_call'
    | 'harness_opening_observation'
    | 'harness_quality_verification';

export interface AgentToolCallLogEntry {
    name: string;
    arguments: any;
    result: any;
    /**
     * 调用归属只用于审计和执行语义分流：Harness 开工观察与质量版本复核都属于真实读取结果，
     * 但不能伪装成模型主动选择的工具、业务写入或质量通过。
     */
    origin?: AgentToolCallOrigin;
    /** 质量复核相位；只有成功的 post_judge 或 final_summary 才能证明收尾版本闭合。 */
    qualityVerificationPhase?: 'pre_judge' | 'post_judge' | 'final_summary';
}

export type TaskCompletionKind =
    | 'skill_evaluation_profile'
    | 'reference_replication'
    | 'creative_design'
    | 'text_content_edit'
    | 'text_typography_edit'
    | 'layer_order_edit'
    | 'layer_management'
    | 'document_save'
    | 'document_close';

export interface TaskCompletionRequirement {
    id: string;
    label: string;
    status: 'passed' | 'failed' | 'needs_review' | 'not_applicable';
    reason?: string;
    expected?: unknown;
    actual?: unknown;
}

export interface TaskCompletionReferenceObservation {
    version: 'task-completion-reference-observation/v1';
    observed: true;
    source:
        | 'attached_image_observation'
        | 'runtime_reference_brief'
        | 'reference_analysis_tool';
    observationCount: number;
    toolName?: string;
}

export interface TaskCompletionVerification {
    toolAcceptance: {
        verified: number;
        failed: number;
        needsReview: number;
        noDocumentChangeRisk: number;
    };
    visual?: {
        mode: 'none' | 'bounds_only' | 'captured_only' | 'screenshot' | 'overlay' | 'model_review';
        snapshotCount?: number;
        overlayCount?: number;
        reviewedCount?: number;
        unreviewedCount?: number;
        blockers?: string[];
        warnings?: string[];
    };
    coverage?: {
        expected: number;
        applied: number;
        failed: number;
        skipped: number;
        missingIds?: string[];
    };
    /** 参考输入已被视觉模型或专用分析 Tool 真实读取后的观察摘要；附件数量本身不是观察结果。 */
    referenceObservation?: TaskCompletionReferenceObservation;
}

export interface TaskCompletionContract {
    kind: TaskCompletionKind;
    status: AgentExecutionStatus;
    required: TaskCompletionRequirement[];
    verification: TaskCompletionVerification;
    blockers: string[];
    warnings: string[];
    summary: string;
}

export interface TaskCompletionContext {
    skillId?: string;
    intentMode?: string;
    imageCount?: number;
    /**
     * 入口签发的请求级计划。完成契约只把它当作稳定任务身份，不能借此授权工具、
     * 推进 Runtime Stage 或直接宣告交付完成。
     */
    agentTaskPlan?: AgentTaskPlanningContract;
    /** 仅由运行时在视觉模型真实消费参考输入后签发。 */
    referenceObservation?: TaskCompletionReferenceObservation;
}

export interface AgentExecutionSummary {
    status: AgentExecutionStatus;
    stopReason: AgentStopReason;
    iterations: number;
    /** 用户任务的业务动作数量；不含能力声明、开工观察和 Harness 质量复核。 */
    businessActionCount?: number;
    /** Harness 控制、开工观察和质量复核数量；仅用于内部诊断，不进入用户完成统计。 */
    harnessActionCount?: number;
    /** 向后兼容字段；新记录与 businessActionCount 保持一致。 */
    toolCallCount: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    /** 成功的 Photoshop 写入或文件交付次数；用户可见层据此判断是否已经改变画面/文件。 */
    successfulMutationCalls?: number;
    /** 成功的文档、画面或图层观察次数；不代表质量通过。 */
    successfulObservationCalls?: number;
    acceptanceVerified: number;
    acceptanceFailed: number;
    acceptanceNeedsReview: number;
    noDocumentChangeRisks: number;
    lastToolName?: string;
    lastError?: string;
    blockers: string[];
    warnings: string[];
    taskCompletion?: TaskCompletionContract;
    /**
     * 完成观察门禁触发的终态降级标记（治幻觉式完成）：为 true 表示本轮改了画面/文件却整轮零观察，
     * 已把"看似完成"降级为 needs_review。它是【终态】信号——buildQualityGateReflexionHandoff 据此抑制
     * reflexion handoff，executor 因 handoff 缺席不进入自动重入循环，绝不重放原任务、绝不重复 mutation。
     * 仅在 baseStatus 本会判 completed 时才置 true，不影响 failed/cancelled 等既有裁决。
     */
    downgradedByObservationGate?: boolean;
    reflexionHandoff?: ReflexionHandoff;
    /**
     * 本轮设计质量评分卡（仅 creative_design 且写后有新鲜结构读时才真评出；可选字段，
     * 不改变既有契约）。供 executor 外层重入循环按各轮评分轨迹执行统一停机口径
     * （decideQualityAwareReflexionReentry）；裁决（pass/fail）仍以 buildDesignVerdict 单一口径为准，
     * 下游不得拿本字段重拼第二套裁决。
     */
    designScorecard?: DesignScorecard;
    /** Profile 评价摘要；完整 scorecard 仍由 designScorecard 保留，最终裁决仍看 designVerdict。 */
    designEvaluationProfileDigest?: DesignEvaluationProfileDigest;
    /** R5 单一机读裁决；下游 Stage State / run record 只能消费它，不得重拼第二套质量判断。 */
    designVerdict?: DesignVerdict;
    /** 只读观察阶段状态；不调度 Tool、不改变本轮 success/failure。 */
    runtimeStageState?: RuntimeStageState;
    /** 同一生产 Session 的身份与阶段摘要；绑定 Stage State / Trace / Run Record。 */
    runtimeSessionDigest?: RuntimeSessionDigest;
    /** Reflexion 代际规划上下文承接摘要；完整声明只留在当前活动 Session。 */
    runtimePlanningContextSeedDigest?: RuntimePlanningContextSeedDigest;
    /** shadow trace 对账摘要；完整有界 trace 仅进入 result.data，不写入长期运行摘要。 */
    runtimeStageTraceDigest?: RuntimeStageTraceDigest;
    /** 模型提交且 Harness 按 manifest 校验的 R1 Design Brief 摘要；不授予执行权。 */
    runtimeDesignBriefDigest?: RuntimeDesignBriefDigest;
    /** 模型提交且 Harness 按 Skill 策略和视觉观察校验的 R2 参考摘要。 */
    runtimeReferenceBriefDigest?: RuntimeReferenceBriefDigest;
    /** 模型提交且 Harness 校验通过的 R3 策略摘要；不代表 artifact 发布或质量通过。 */
    runtimeDesignStrategyDigest?: RuntimeDesignStrategyDigest;
    /** 模型提交且 Harness 校验通过的 R4 动态计划摘要；只做影子记录，不调度 Tool。 */
    runtimeActionPlanDigest?: RuntimeActionPlanDigest;
    /** R4 节点与真实执行的影子对账摘要；续跑位置仅供核实，不是调度命令。 */
    runtimeActionPlanReconciliationDigest?: RuntimeActionPlanReconciliationDigest;
    /** 跨轮已完成节点的 no-redo 影子摘要；只观察模型映射和重复事实，不阻断 Tool。 */
    runtimeActionPlanNoRedoShadowDigest?: RuntimeActionPlanNoRedoShadowDigest;
    summaryText: string;
}

export interface AgentRunResult {
    success: boolean;
    message: string;
    messages: AgentMessage[];
    iterations: number;
    toolCallLog: AgentToolCallLogEntry[];
    cancelled?: boolean;
    error?: string;
    stopReason?: AgentStopReason;
    executionSummary?: AgentExecutionSummary;
    data?: Record<string, unknown>;
}

export type CallModelFn = (
    modelId: string,
    messages: AgentMessage[],
    tools: ToolSchema[],
    options?: { maxTokens?: number; temperature?: number; nativeTools?: ProviderNativeToolRequest[]; timeoutMs?: number; thinkingEnabled?: boolean }
) => Promise<{
    content?: string;
    toolCalls?: ToolCall[];
    thinking?: string;
    usage?: { inputTokens: number; outputTokens: number };
    stopReason?: string;
}>;

export type CallModelStreamFn = (
    modelId: string,
    messages: AgentMessage[],
    tools: ToolSchema[],
    options?: {
        maxTokens?: number;
        temperature?: number;
        nativeTools?: ProviderNativeToolRequest[];
        timeoutMs?: number;
        thinkingEnabled?: boolean;
        onContentDelta?: (fullContent: string, delta: string) => void;
        onThinkingDelta?: (fullThinking: string, delta: string) => void;
        onToolCallDelta?: (chunk: {
            index: number;
            toolCallId?: string;
            name?: string;
            argumentsDelta?: string;
        }) => void;
        onToolCallReady?: (toolCall: ToolCall) => void;
    }
) => Promise<{
    content?: string;
    toolCalls?: ToolCall[];
    thinking?: string;
    usage?: { inputTokens: number; outputTokens: number };
    stopReason?: string;
    streamMode?: 'stream' | 'fallback';
}>;

export interface ExecuteToolRuntimeContext {
    runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
    runtimeDesignBriefDigest?: RuntimeDesignBriefDigest;
    runtimeDesignBriefRequiredInputKeys?: string[];
    runtimeReferenceBriefDeclaration?: RuntimeReferenceBriefDeclaration;
    runtimeReferenceBriefDigest?: RuntimeReferenceBriefDigest;
    runtimeDesignStrategyDeclaration?: RuntimeDesignStrategyDeclaration;
    runtimeDesignStrategyDigest?: RuntimeDesignStrategyDigest;
    runtimeActionPlanDeclaration?: RuntimeActionPlanDeclaration;
    runtimeActionPlanDigest?: RuntimeActionPlanDigest;
}

export type ExecuteToolFn = (
    toolName: string,
    params: any,
    runtimeContext?: ExecuteToolRuntimeContext
) => Promise<any>;
