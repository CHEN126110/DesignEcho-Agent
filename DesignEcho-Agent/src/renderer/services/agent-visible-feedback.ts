import type { AgentStepEvent } from './agent-runtime/types';
import { getToolDisplayInfo } from './tool-display-info';
import { getDesignTeammateDefinition } from './design-teams';
import { getSkillById } from '../../shared/skills/skill-declarations';
import type { DesignTeammateRole } from '../../shared/types/design-team.types';
import {
    canObservationEnterThinkingSteps,
    canObservationRenderAsToolCall,
    classifyAgentObservationChannel
} from '../../shared/agent-observation-channels';
import {
    sanitizeUserVisibleDiagnosticText,
    sanitizeUserVisibleThinkingText
} from '../../shared/chat-response-cleaner';

type VisibleStepLike = {
    type: string;
    content?: string;
    toolName?: string;
};

export type VisibleAgentActivityKind =
    | 'request'
    | 'router'
    | 'skill'
    | 'autonomous_agent'
    | 'teammate';

export type VisibleAgentRunPhase =
    | 'context_loading'
    | 'agent_processing';

export interface VisibleAgentActivity {
    kind: VisibleAgentActivityKind;
    agentId: string;
    agentLabel: string;
    detail?: string;
    source: 'initial' | 'run_phase' | 'skill_event' | 'teammate_event' | 'progress_event';
    userVisible: true;
    showAsThinking: false;
    isProviderThinking: false;
    canClaimModelReasoning: false;
}

const VISIBLE_TOOL_EVENT_KINDS = new Set<AgentStepEvent['kind']>([
    'tool_started',
    'tool_completed'
]);

const VISIBLE_PROCESS_EVENT_KINDS = new Set<AgentStepEvent['kind']>([
    'observation',
    'verification',
    'warning',
    'finalizing'
]);

// 模型请求/响应、任务开始、工具计划（model_request/model_response/task_started/
// tool_planned）属于 Agent 内部流程播报，不作为用户可见步骤——它们会和「工具执行行」
// 以及模型自己的思考正文重复，把真正有价值的内容淹没成满屏「观察」噪音。
// 用户侧的进度由：实时活动摘要 + 模型公开思考正文 + 工具执行行共同表达。
// 该收敛同时是 smoke-chat-ui-execution-chain 的可见性契约（不得暴露 model_request/response）。

const DESIGNER_VISIBLE_ACTIVITY_ID = 'design-assistant';
const DESIGNER_VISIBLE_ACTIVITY_LABEL = '设计助手';
const VISIBLE_AGENT_RUN_PHASE_DETAIL: Record<VisibleAgentRunPhase, string> = {
    context_loading: '正在检查当前项目与 Photoshop 状态。',
    agent_processing: '已完成环境检查，设计助手正在处理当前需求。'
};

function canRenderStepAsUserFacing(event: AgentStepEvent): boolean {
    if (event.audience === 'agent' || event.audience === 'debug') return false;
    if (event.source === 'model') return true;
    if (event.source !== 'agent_runtime') return false;
    // Explicitly user-facing events: show if kind is in any visible set.
    if (event.audience === 'user' && event.visibility === 'user_process') {
        return VISIBLE_PROCESS_EVENT_KINDS.has(event.kind)
            || VISIBLE_TOOL_EVENT_KINDS.has(event.kind);
    }
    return false;
}

export const isSkillWrapperToolEvent = (event: AgentStepEvent): boolean => {
    const title = String(event.title || '');
    return /^开始能力：|^能力完成：|^能力已执行：|^能力部分完成：|^能力待复核：|^能力待确认：|^能力受阻：|^能力失败：|^能力已停止：|^能力未完成：|^能力不可用：|^能力异常：/.test(title);
};

export const isTeammateWrapperToolEvent = (event: AgentStepEvent): boolean => {
    const title = String(event.title || '');
    return /^开始子 Agent：|^子 Agent 完成：|^子 Agent 失败：/.test(title);
};

function buildActivityBase(
    kind: VisibleAgentActivityKind,
    agentId: string,
    agentLabel: string,
    source: VisibleAgentActivity['source'],
    detail?: string
): VisibleAgentActivity {
    const safeDetail = detail
        ? sanitizeUserVisibleDiagnosticText(String(detail).trim())
        : undefined;
    return {
        kind,
        agentId,
        agentLabel,
        detail: safeDetail || undefined,
        source,
        userVisible: true,
        showAsThinking: false,
        isProviderThinking: false,
        canClaimModelReasoning: false
    };
}

export function buildVisibleAgentActivityFromRunPhase(
    phase: VisibleAgentRunPhase,
    current?: VisibleAgentActivity | null
): VisibleAgentActivity {
    return buildActivityBase(
        current?.kind || 'request',
        current?.agentId || DESIGNER_VISIBLE_ACTIVITY_ID,
        current?.agentLabel || DESIGNER_VISIBLE_ACTIVITY_LABEL,
        'run_phase',
        VISIBLE_AGENT_RUN_PHASE_DETAIL[phase]
    );
}

export function buildVisibleAgentActivityFromProgress(
    message: string,
    current?: VisibleAgentActivity | null
): VisibleAgentActivity | null {
    const detail = sanitizeUserVisibleDiagnosticText(String(message || '').trim());
    if (!detail) return null;

    return buildActivityBase(
        current?.kind || 'request',
        current?.agentId || DESIGNER_VISIBLE_ACTIVITY_ID,
        current?.agentLabel || DESIGNER_VISIBLE_ACTIVITY_LABEL,
        'progress_event',
        detail
    );
}

function extractSkillId(event: AgentStepEvent): string {
    const detail = String(event.detail || '').trim();
    const match = detail.match(/能力 ID:\s*([^\s]+)/);
    if (match?.[1]) return match[1];
    return String(event.toolName || '').trim();
}

function extractTeammateRole(event: AgentStepEvent): DesignTeammateRole | '' {
    const detail = String(event.detail || '').trim();
    const detailMatch = detail.match(/子 Agent role:\s*([^\s]+)/);
    if (detailMatch?.[1]) return detailMatch[1] as DesignTeammateRole;

    const toolName = String(event.toolName || '').trim();
    const toolMatch = toolName.match(/^delegateToAgent:([^\s]+)/);
    if (toolMatch?.[1]) return toolMatch[1] as DesignTeammateRole;

    return '';
}

function getVisibleSkillIdentity(skillId: string, fallbackLabel: string): { agentId: string; label: string } {
    const skill = getSkillById(skillId);
    if (!skill || skill.visibility !== 'user-facing') {
        return {
            agentId: DESIGNER_VISIBLE_ACTIVITY_ID,
            label: DESIGNER_VISIBLE_ACTIVITY_LABEL
        };
    }
    return {
        agentId: skill.id || skillId || DESIGNER_VISIBLE_ACTIVITY_ID,
        label: skill.name || fallbackLabel || DESIGNER_VISIBLE_ACTIVITY_LABEL
    };
}

function getVisibleTeammateLabel(role: DesignTeammateRole, fallbackLabel: string): string {
    const definition = getDesignTeammateDefinition(role);
    return definition?.displayName || fallbackLabel || role || 'Design Teammate';
}

function buildVisibleTeammateActivityFromStepEvent(
    event: AgentStepEvent
): VisibleAgentActivity | null {
    const role = extractTeammateRole(event);
    if (!role) return null;

    const titleLabel = String(event.title || '')
        .replace(/^开始子 Agent：|^子 Agent 完成：|^子 Agent 失败：/, '')
        .trim();
    const label = getVisibleTeammateLabel(role, titleLabel);

    return buildActivityBase(
        'teammate',
        role,
        label,
        'teammate_event',
        event.detail
    );
}

export function buildVisibleAgentActivityFromStepEvent(
    event: AgentStepEvent
): VisibleAgentActivity | null {
    if (event && isTeammateWrapperToolEvent(event)) {
        return buildVisibleTeammateActivityFromStepEvent(event);
    }

    if (!event || !isSkillWrapperToolEvent(event)) return null;
    const skillId = extractSkillId(event);
    if (!skillId) return null;

    const titleLabel = String(event.title || '')
        .replace(/^开始能力：|^能力完成：|^能力已执行：|^能力部分完成：|^能力待复核：|^能力待确认：|^能力受阻：|^能力失败：|^能力已停止：|^能力未完成：|^能力不可用：|^能力异常：/, '')
        .trim();
    const kind: VisibleAgentActivityKind = skillId === 'autonomous-agent'
        ? 'autonomous_agent'
        : 'skill';
    const identity = getVisibleSkillIdentity(skillId, titleLabel);

    return buildActivityBase(kind, identity.agentId, identity.label, 'skill_event');
}

export const isVisibleAgentStepEvent = (event: AgentStepEvent): boolean => {
    return canRenderStepAsUserFacing(event)
        && VISIBLE_TOOL_EVENT_KINDS.has(event.kind)
        && !isSkillWrapperToolEvent(event)
        && typeof event.toolName === 'string'
        && event.toolName.trim().length > 0;
};

export const isVisibleAgentProcessEvent = (event: AgentStepEvent): boolean => {
    return canRenderStepAsUserFacing(event)
        && VISIBLE_PROCESS_EVENT_KINDS.has(event.kind)
        && !isSkillWrapperToolEvent(event)
        && !isTeammateWrapperToolEvent(event)
        && typeof event.title === 'string'
        && event.title.trim().length > 0;
};

export const getVisibleAgentProcessStepType = (
    event: AgentStepEvent
): 'status' | 'decision' | 'analyzing' => {
    if (event.kind === 'verification') return 'decision';
    if (event.kind === 'warning' || event.kind === 'finalizing') return 'status';
    // observation 等观察类作为 'analyzing'（观察角色）展示。
    return 'analyzing';
};

function looksLikeEngineeringRuntimeProcessText(value: string): boolean {
    return /(?:\b(?:Harness|Runtime|system prompt|tool call|debug|route|gate)\b|第\s*\d+\s*轮|成功\s*\d+\s*项|失败\s*\d+\s*项|\b(?:request|declare|update|get)[A-Z][A-Za-z0-9]+\b)/iu.test(value);
}

function buildDesignerFacingProcessFallback(event: AgentStepEvent): string {
    if (event.status === 'error') {
        return '当前处理条件还不完整，暂时不能确认画面结果。';
    }
    if (event.kind === 'verification') {
        return '正在复核画面是否符合设计目标。';
    }
    return '正在结合现有素材和画面结果调整设计判断。';
}

export const formatAgentProcessEventContent = (event: AgentStepEvent): string => {
    const title = sanitizeUserVisibleDiagnosticText(String(event.title || '').trim());
    const detail = sanitizeUserVisibleDiagnosticText(String(event.detail || '').trim());
    const content = [title, detail]
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
        .join('：');

    if (looksLikeEngineeringRuntimeProcessText(content)) {
        return buildDesignerFacingProcessFallback(event);
    }

    return content
        .replace(/并行执行/g, '同时检查')
        .replace(/只读操作/g, '检查步骤')
        .replace(/工具调用/g, '画面处理')
        .replace(/工具/g, '处理')
        .replace(/模型/g, '设计助手');
};

export const formatAgentToolEventContent = (event: AgentStepEvent): string => {
    const toolName = String(event.toolName || '').trim();
    const info = getToolDisplayInfo(toolName);
    if (toolName === 'providerNativeWebSearch') {
        const detail = sanitizeUserVisibleDiagnosticText(String(event.detail || '').trim());
        if (detail) return detail;
    }

    if (event.status === 'error') {
        return `${info.name}未完成`;
    }

    if (event.status === 'running' || event.status === 'pending') {
        return `${info.name}中`;
    }
    return `已${info.name}`;
};

export const isVisiblePonderingStep = (step: VisibleStepLike): boolean => {
    const content = String(step.content || '').trim();
    if (step.type === 'thinking') {
        const visibleThinking = sanitizeUserVisibleThinkingText(content);
        if (!visibleThinking) return false;
        return canObservationEnterThinkingSteps(classifyAgentObservationChannel({
            source: 'model_visible_reasoning',
            content: visibleThinking
        }));
    }
    if (step.type === 'tool_call' || step.type === 'tool_result') {
        return canObservationRenderAsToolCall(classifyAgentObservationChannel({
            source: step.type === 'tool_call' ? 'tool_call_started' : 'tool_call_completed',
            content,
            toolName: step.toolName
        }));
    }
    if (step.type === 'status'
        || step.type === 'decision'
        || step.type === 'reading'
        || step.type === 'exploring'
        || step.type === 'analyzing') {
        return sanitizeUserVisibleDiagnosticText(content).length > 0;
    }
    return false;
};
