/**
 * 主循环视觉观察策略（纯逻辑，可 smoke）。
 *
 * 背景：主自主循环按任务类型选「一个」模型跑整轮。若主模型是逻辑模型（不支持读图），
 * 之前图片没有送达可读图模型，主模型会对画面「瞎判断」。
 *
 * 本模块决定每张快照怎么观察，落实「强模型主导 + 视觉专家协同」（类多 Agent）：
 * - primary-self：主模型自己支持视觉 → 图直接回传，主模型自己看。
 * - visual-expert：主模型不支持视觉，但配了可用的视觉槽模型 → 让视觉专家替它看，
 *   把文字判断注入主模型上下文（主模型仍负责编排与决策）。
 * - no-visual-capability：主模型不支持视觉、又没有可用视觉模型 → 如实告知主模型
 *   「无法核对画面」，不静默假装看过（诚实失败优于伪造已确认）。
 */

export type VisualObservationStrategy = 'primary-self' | 'visual-expert' | 'no-visual-capability';

export type AgentVisualObservationStatus =
    | 'presented_to_primary'
    | 'observed_by_primary'
    | 'observed_by_visual_expert'
    | 'not_observed';

export interface AgentVisualObservation {
    version: 'agent-visual-observation/v1';
    status: AgentVisualObservationStatus;
    reviewed: boolean;
    observer: 'primary_model' | 'visual_expert' | 'none';
    strategy: VisualObservationStrategy;
    toolName: string;
    reason?:
        | 'no_visual_capability'
        | 'visual_expert_empty'
        | 'visual_expert_failed'
        | 'observation_budget_exhausted'
        | 'vision_candidate_budget_exhausted'
        | 'visual_analysis_budget_exhausted';
}

export function writeAgentVisualObservation(
    toolResult: unknown,
    observation: Omit<AgentVisualObservation, 'version'>
): AgentVisualObservation | undefined {
    if (!toolResult || typeof toolResult !== 'object' || !Object.isExtensible(toolResult)) return undefined;
    const record: AgentVisualObservation = {
        version: 'agent-visual-observation/v1',
        ...observation
    };
    (toolResult as Record<string, unknown>).agentVisualObservation = record;
    return record;
}

export function readAgentVisualObservation(toolResult: unknown): AgentVisualObservation | undefined {
    if (!toolResult || typeof toolResult !== 'object') return undefined;
    const record = (toolResult as Record<string, any>).agentVisualObservation;
    if (record?.version !== 'agent-visual-observation/v1') return undefined;
    return record as AgentVisualObservation;
}

export function resolveVisualObservationStrategy(input: {
    primaryModelSupportsVision: boolean;
    visualExpertModelId?: string;
    visualExpertSupportsVision?: boolean;
}): VisualObservationStrategy {
    if (input.primaryModelSupportsVision) {
        return 'primary-self';
    }
    const expertId = String(input.visualExpertModelId || '').trim();
    if (expertId && input.visualExpertSupportsVision) {
        return 'visual-expert';
    }
    return 'no-visual-capability';
}

/**
 * 视觉专家替主模型看图时的聚焦指令。
 * 同时按设计质量自检反馈（不止排版正确性），与 design-principles 的排版及格线红线呼应。
 */
export const VISUAL_EXPERT_OBSERVATION_PROMPT = [
    '你是视觉核对专家。只根据这张设计稿画面，如实描述当前真实状态，供主 Agent 决定下一步：',
    '1) 主体是什么、是否清晰突出；主体相对容器是过大、过小还是合适，裁切是否合理；',
    '2) 构图与层次：主次是否清楚、有无明显空洞或失衡；主体重心是否需要移动；',
    '3) 排版问题：文字/元素有无遮挡、重叠、出血、对齐错乱、超出画布；',
    '4) 文字是否清晰可读；',
    '5) 是否还停在「产品图 + 居中文字、白底、无背景设计」的排版级，缺少设计感。',
    '若主体大小或位置有问题，请明确建议放大、缩小或移动方向，但不要猜像素坐标或固定缩放百分比。',
    '用简体中文分条说事实，简洁直接，不要客套，绝不编造画面上看不到的内容。'
].join('\n');

/** 用户附件交给视觉专家时的独立观察指令；主模型只接收结构化视觉结论。 */
export const VISUAL_EXPERT_INPUT_PROMPT = [
    '你是主 Agent 的视觉专家。请只根据用户上传的图片提取可验证的视觉事实：',
    '1) 每张图片的主体、场景、文字和关键视觉元素；',
    '2) 构图、层级、配色、排版与风格特征；',
    '3) 与用户目标直接相关、可供后续设计或 Photoshop 操作使用的约束；',
    '4) 无法从图片确认的内容要明确标为未知。',
    '按图片顺序用简体中文输出精炼的结构化观察；不要替主 Agent 做最终决策，不要编造。'
].join('\n');
