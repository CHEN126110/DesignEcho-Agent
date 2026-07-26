import type { DesignImageInput } from '../../../shared/design-image-input';
import type { DesignDimensionSpec } from '../../../shared/design-dimension-spec';
import type { AgentTaskPlanPresentation } from '../../../shared/agent-task-plan-presentation';
import type { ChatWebSearchIntent } from '../../../shared/chat-web-search-policy';
import type { AgentResumableTaskMessageLike } from '../../../shared/agent-resumable-task-contract';
import type { AgentResumeReadonlyToolHandlers } from '../../../shared/agent-resume-context-pipeline';
import type { SkillExecutionOutcome } from '../../../shared/agent-react-observation-contract';
import type { ContextSnapshot, ProjectAssetIndex } from '../../../shared/project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from '../../../shared/project-visual-insight-cache';
import type { ProjectVisualSamplingPlan } from '../../../shared/project-visual-sampling';
import type { AgentStepEvent } from '../agent-runtime';
import type { AgentTaskPublicPlanControlledOperationRequest } from '../../../shared/agent-task-public-plan-execution-request';
import type { AssistantReplyOrigin } from '../../../shared/assistant-reply-origin';
import type { OperatingContextSnapshot } from '../../../shared/agent-runtime-v5/operating-context-snapshot';
import type { InteractiveContinuationRequest } from '../../../shared/pending-interactive-continuation';
import type {
    AgentTaskPublicPlanControlledAsyncAdapter,
    AgentTaskPublicPlanControlledRunnerTarget,
    AgentTaskPublicPlanLiveExecutionScope
} from '../../../shared/agent-task-public-plan-controlled-runner';

export interface AgentContext {
    userInput: string;
    conversationHistory: AgentResumableTaskMessageLike[];
    requestId?: string;
    conversationId?: string;
    interactiveContinuationRequest?: InteractiveContinuationRequest;
    isPluginConnected?: boolean;
    photoshopContext?: PhotoshopContext;
    projectContext?: ProjectContext;
    operatingContextSnapshot?: OperatingContextSnapshot;
    designDimensionSpec?: Partial<DesignDimensionSpec>;
    hasAttachedImage?: boolean;
    attachedImageData?: string;
    attachedImages?: DesignImageInput[];
    providerNativeWebSearchIntent?: ChatWebSearchIntent;
    visualEmbedding?: number[];
    layoutEmbedding?: number[];
    resumeReadonlyToolHandlers?: AgentResumeReadonlyToolHandlers;
    agentTaskPublicPlanApproval?: {
        userConfirmed?: boolean;
        approveGeneratedPublicPlan?: boolean;
        allowedWriteTools?: string[];
        enableControlledExecutionRequest?: boolean;
        requestId?: string;
        sourceMessageId?: string;
        runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
        executionTarget?: AgentTaskPublicPlanControlledRunnerTarget;
        allowPhotoshopWrites?: boolean;
        liveExecutionScope?: AgentTaskPublicPlanLiveExecutionScope;
        explicitProjectWriteApproval?: boolean;
        adapter?: AgentTaskPublicPlanControlledAsyncAdapter;
    };
}

export interface PhotoshopContext {
    hasDocument: boolean;
    documentId?: number;
    documentName?: string;
    canvasSize?: { width: number; height: number };
    activeLayerId?: number;
    activeLayerName?: string;
    layerCount?: number;
    observedAt?: string;
    revision?: string;
}

export interface ProjectContext {
    projectId?: string;
    projectName?: string;
    projectPath?: string;
    hasSkuFiles?: boolean;
    hasTemplates?: boolean;
    availableColors?: string[];
    projectImageCount?: number;
    projectImageFolders?: Array<{ path: string; imageCount: number }>;
    sampleImagePaths?: string[];
    selectedProjectImagePath?: string;
    selectedProjectImageName?: string;
    assetIndex?: ProjectAssetIndex;
    visualSamplingPlan?: ProjectVisualSamplingPlan;
    visualInsightCache?: ProjectVisualInsightCacheReadResult;
    contextSnapshot?: ContextSnapshot;
    contextSnapshotSource?: 'runtime-project-service' | 'renderer-project-structure';
    contextSnapshotWarnings?: string[];
    contextSnapshotLimitations?: string[];
}

export type AgentProjectMemoryScope =
    | { type: 'user' }
    | { type: 'project'; id: string };

export function resolveAgentProjectMemoryScope(
    projectContext?: Pick<ProjectContext, 'projectId'>
): AgentProjectMemoryScope {
    const projectId = String(projectContext?.projectId || '').trim();
    return projectId
        ? { type: 'project', id: projectId }
        : { type: 'user' };
}

export interface AgentDecision {
    type: 'tool_call' | 'skill_execution' | 'direct_response' | 'clarification_needed';
    toolCalls?: Array<{ toolName: string; params: any; reason?: string }>;
    skillId?: string;
    skillParams?: Record<string, any>;
    directResponse?: string;
    clarificationQuestion?: string;
    reasoning?: string;
}

export type AgentUserVisibleNoticeKind =
    | 'status_notice'
    | 'tool_summary'
    | 'blocker_notice';

export interface AgentUserVisibleNotice {
    kind: AgentUserVisibleNoticeKind;
    content: string;
    source?: string;
}

export interface AgentResult {
    success: boolean;
    message: string;
    /**
     * `success` 只表示没有致命执行错误；只有这里显式为 completed 才能声明任务完成。
     */
    skillOutcome?: SkillExecutionOutcome;
    assistantReplyOrigin?: AssistantReplyOrigin;
    userVisibleNotice?: AgentUserVisibleNotice;
    toolResults?: any[];
    error?: string;
    cancelled?: boolean;
    data?: any;
}

import type { AgentThinkingEventMeta } from '../../../shared/agent-observation-channels';

export interface ExecutionCallbacks {
    onProgress?: (message: string, percent: number) => void;
    onStep?: (step: AgentStepEvent) => void;
    onStatus?: (message: string) => void;
    onToolStart?: (toolName: string) => void;
    onToolComplete?: (toolName: string, result: any) => void;
    onMessage?: (message: string) => void;
    onThinking?: (thinking: string, meta?: AgentThinkingEventMeta) => void;
    /** R4 + reconciliation 的脱敏展示投影；只更新 UI，不拥有任务完成状态。 */
    onTaskPlanPresentation?: (presentation: AgentTaskPlanPresentation) => void;
    /** Agent 看过的画面快照，转发给用户（内联到「判断与处理」步骤流）。与 AgentCallbacks.onSnapshotImage 同签名。 */
    onSnapshotImage?: (snapshot: { data: string; mediaType: string; toolName: string; index: number }) => void;
}

export interface ProcessOptions {
    callModel?: (messages: Array<{ role: string; content: any }>, options?: any) => Promise<{ text?: string; thinking?: string }>;
    callbacks?: ExecutionCallbacks;
    signal?: AbortSignal;
}

export interface DeterministicSkillRoute {
    skillId: string;
    skillParams: Record<string, any>;
    thinking?: string;
}

export type LightweightIntent =
    | 'greeting'
    | 'thanks'
    | 'ack'
    | 'identity'
    | 'model_compare'
    | 'capability'
    | 'task_summary'
    | 'continuation'
    | 'chat'
    | 'none';
