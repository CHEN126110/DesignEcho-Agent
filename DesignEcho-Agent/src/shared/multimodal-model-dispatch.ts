import type { ModelPreferences } from './config/models.config';
import { getModelById, isConversationModelConfig } from './config/models.config';
import {
    getModelPriorityForConversationTask,
    type ConversationTaskType
} from './model-selection';
import type { DesignTeammateRole } from './types/design-team.types';

export type ModelCapabilitySlot = 'logic' | 'copywriting' | 'visual';
export type ModelDispatchConsumer = 'primary-agent' | 'teammate' | 'skill';
export type ModelDispatchContextMode = 'structured_task_context';

export interface BuildMultimodalModelDispatchInput {
    consumer: ModelDispatchConsumer;
    role?: DesignTeammateRole;
    taskType?: ConversationTaskType;
    userTask?: string;
    hasImage?: boolean;
    prefs?: Partial<ModelPreferences> | null;
    mode?: 'local' | 'cloud' | 'auto';
    includeFallback?: boolean;
    includeCrossTaskBackups?: boolean;
    requireToolUse?: boolean;
    requireVision?: boolean;
    explicitModelId?: string;
    availableModels?: string[];
}

export interface ModelDispatchContextPolicy {
    mode: ModelDispatchContextMode;
    includeFullConversation: false;
    requiredContext: string[];
    maxDigestChars: number;
}

export interface ModelDispatchHandoffBoundary {
    primaryAgentRetainsFinalJudgment: true;
    expertReturnsConclusionOnly: true;
    expertMayDirectlyExecuteTools: false;
    notes: string[];
}

export interface MultimodalModelDispatchPlan {
    version: 'multimodal-model-dispatch/v0';
    architecture: 'stable-primary-agent-with-expert-models';
    consumer: ModelDispatchConsumer;
    role?: DesignTeammateRole;
    taskType: ConversationTaskType;
    capabilitySlot: ModelCapabilitySlot;
    selectedModelId: string;
    candidateModelIds: string[];
    publicReason: string;
    contextPolicy: ModelDispatchContextPolicy;
    handoffBoundary: ModelDispatchHandoffBoundary;
}

const ROLE_TASK_TYPE: Record<DesignTeammateRole, ConversationTaskType> = {
    'scene-analyst': 'visual',
    'market-researcher': 'logic',
    copywriter: 'copywriting',
    'design-strategist': 'logic',
    executor: 'logic',
    critic: 'visual'
};

const SLOT_LABEL: Record<ModelCapabilitySlot, string> = {
    logic: '逻辑',
    copywriting: '文案',
    visual: '视觉'
};

function uniqNonEmpty(values: Array<string | undefined | null>): string[] {
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

function isKnownOrAvailableModel(modelId: string, availableModels?: string[]): boolean {
    if (!modelId) return false;
    if (availableModels?.includes(modelId)) return true;
    return Boolean(getModelById(modelId));
}

function modelMeetsDispatchRequirements(
    modelId: string,
    input: BuildMultimodalModelDispatchInput,
    taskType: ConversationTaskType
): boolean {
    if (!isKnownOrAvailableModel(modelId, input.availableModels)) return false;
    const model = getModelById(modelId);
    if (!isConversationModelConfig(model)) return false;
    const requireVision = input.requireVision ?? taskType === 'visual';
    if (requireVision && model?.supportsVision !== true) return false;
    if ((input.requireToolUse ?? true) && model?.supportsToolUse === false) return false;
    return true;
}

export function resolveTaskTypeForDesignRole(role: DesignTeammateRole): ConversationTaskType {
    return ROLE_TASK_TYPE[role] || 'logic';
}

export function resolveCapabilitySlotForTaskType(taskType: ConversationTaskType): ModelCapabilitySlot {
    switch (taskType) {
        case 'visual':
            return 'visual';
        case 'copywriting':
            return 'copywriting';
        case 'general':
        case 'logic':
        default:
            return 'logic';
    }
}

export function formatCapabilitySlotLabel(slot: ModelCapabilitySlot): string {
    return SLOT_LABEL[slot] || slot;
}

function resolveDispatchTaskType(input: BuildMultimodalModelDispatchInput): ConversationTaskType {
    if (input.taskType) return input.taskType;
    if (input.role) return resolveTaskTypeForDesignRole(input.role);
    if (input.hasImage) return 'visual';
    return 'logic';
}

function buildRequiredContext(input: BuildMultimodalModelDispatchInput, taskType: ConversationTaskType): string[] {
    const required = ['用户当前任务', '当前项目状态摘要', '本轮已完成的关键判断'];
    if (input.consumer === 'teammate') required.push('团队共享工作区摘要');
    if (taskType === 'visual') required.push('当前画面快照或素材视觉摘要');
    if (taskType === 'copywriting') required.push('产品卖点、用户痛点和已确认文案约束');
    if (taskType === 'logic') required.push('可执行工具边界和待验证结果');
    return required;
}

function buildPublicReason(input: BuildMultimodalModelDispatchInput, slot: ModelCapabilitySlot, selectedModelId: string): string {
    const rolePart = input.role ? `${input.role} ` : '';
    const modelRole = slot === 'visual' ? '视觉模型' : '主模型';
    if (!selectedModelId) {
        return `${rolePart}这一步暂时没有可用的${modelRole}，请检查模型设置。`;
    }
    if (input.consumer === 'primary-agent') {
        return `主模型 ${selectedModelId} 负责理解需求、设计判断和最终回复；需要看图时再请视觉模型补充。`;
    }
    return slot === 'visual'
        ? `${rolePart}这一步交给视觉模型 ${selectedModelId} 看图，结论交回主模型继续完成任务。`
        : `${rolePart}这一步由主模型 ${selectedModelId} 完成专业判断。`;
}

export function buildMultimodalModelDispatchPlan(
    input: BuildMultimodalModelDispatchInput
): MultimodalModelDispatchPlan {
    const taskType = resolveDispatchTaskType(input);
    const capabilitySlot = resolveCapabilitySlotForTaskType(taskType);
    const explicitModelId = String(input.explicitModelId || '').trim();
    const candidates = uniqNonEmpty([
        explicitModelId,
        ...getModelPriorityForConversationTask(input.prefs, taskType, {
            mode: input.mode,
            includeFallback: input.includeFallback,
            includeCrossTaskBackups: input.includeCrossTaskBackups ?? true,
            requireVision: input.requireVision ?? taskType === 'visual',
            requireToolUse: input.requireToolUse ?? true
        })
    ]).filter((modelId) => modelMeetsDispatchRequirements(modelId, input, taskType));
    const selectedModelId = candidates[0] || '';

    return {
        version: 'multimodal-model-dispatch/v0',
        architecture: 'stable-primary-agent-with-expert-models',
        consumer: input.consumer,
        ...(input.role ? { role: input.role } : {}),
        taskType,
        capabilitySlot,
        selectedModelId,
        candidateModelIds: candidates,
        publicReason: buildPublicReason(input, capabilitySlot, selectedModelId),
        contextPolicy: {
            mode: 'structured_task_context',
            includeFullConversation: false,
            requiredContext: buildRequiredContext(input, taskType),
            maxDigestChars: input.consumer === 'primary-agent' ? 8000 : 6000
        },
        handoffBoundary: {
            primaryAgentRetainsFinalJudgment: true,
            expertReturnsConclusionOnly: true,
            expertMayDirectlyExecuteTools: false,
            notes: [
                '主 Agent 负责最终决策和工具执行顺序。',
                '专家模型只读取结构化上下文，返回判断、建议或评审结论。',
                '不要把完整历史对话无差别交给专家模型，避免上下文漂移。'
            ]
        }
    };
}

export function formatModelDispatchTrace(plan: MultimodalModelDispatchPlan): string {
    const roleText = plan.role ? `（${plan.role}）` : '';
    const slotLabel = formatCapabilitySlotLabel(plan.capabilitySlot);
    const modelText = plan.selectedModelId || '默认模型';
    return [
        `模型调度${roleText}：使用${slotLabel}模型 ${modelText}。`,
        plan.publicReason,
        '边界：主 Agent 保留最终判断；专家模型只提供结论，不直接接管工具执行。',
        `上下文：使用结构化任务摘要，不直接传递完整对话；需要：${plan.contextPolicy.requiredContext.join('、')}。`
    ].join('\n');
}

export function formatPrimaryAgentDispatchPromptSection(plan: MultimodalModelDispatchPlan): string {
    return [
        '## 模型分工',
        `- 你是本轮主模型：${plan.selectedModelId || '当前配置的主模型'}。`,
        '- 你负责理解用户、做设计判断、安排必要动作并给出最终回复。',
        '- 只有在需要看图或复核画面时才请视觉模型补充；视觉观察不替代你的最终判断。',
        '- 面向用户只谈设计目标、画面判断、处理结果和必要选择，不谈模型分工或内部处理机制。',
        `- 继续任务所需信息：${plan.contextPolicy.requiredContext.join('、')}。`
    ].join('\n');
}
