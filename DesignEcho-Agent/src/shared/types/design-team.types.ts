export type DesignTeammateRole =
    | 'scene-analyst'
    | 'market-researcher'
    | 'copywriter'
    | 'design-strategist'
    | 'executor'
    | 'critic';

export type DesignTeamMessageType =
    | 'scene_summary'
    | 'market_research'
    | 'copy_strategy'
    | 'design_plan'
    | 'execution_report'
    | 'review_report'
    | 'revision_request'
    | 'task_context'
    | 'task_status'
    | 'model_dispatch_trace';

export type DesignTeammateTaskStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface DesignTeamMessage<TPayload = Record<string, unknown>> {
    type: DesignTeamMessageType;
    fromRole: DesignTeammateRole;
    toRole?: DesignTeammateRole | 'coordinator';
    taskId?: string;
    timestamp?: string;
    payload: TPayload;
}

export interface DesignTeammateDefinition {
    role: DesignTeammateRole;
    displayName: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    maxIterations: number;
    outputType: DesignTeamMessageType;
    canWriteToPhotoshop: boolean;
}

export interface DesignTeammateTaskRequest {
    role: DesignTeammateRole;
    task: string;
    context?: string;
    modelId?: string;
    maxIterations?: number;
}

export interface DesignTeammateTaskResult {
    success: boolean;
    taskId: string;
    role: DesignTeammateRole;
    status: DesignTeammateTaskStatus;
    message: string;
    iterations: number;
    toolsUsed: string[];
    outputType: DesignTeamMessageType;
    startedAt: string;
    finishedAt: string;
    messages: DesignTeamMessage[];
    outputMessage?: DesignTeamMessage<{
        success: boolean;
        message: string;
        iterations: number;
        toolsUsed: string[];
        error?: string;
    }>;
    error?: string;
}

// ==================== 团队共享工作区（黑板） ====================

/** 一条沉淀到团队工作区的队友产出 */
export interface DesignTeamWorkspaceEntry {
    role: DesignTeammateRole;
    outputType: DesignTeamMessageType;
    /** 流水线阶段标签（如 analyze/plan/execute/review/revise-1） */
    stage: string;
    success: boolean;
    /** 队友的最终文本产出 */
    content: string;
    toolsUsed: string[];
    timestamp: string;
}

// ==================== 评审裁决 ====================

export type DesignCriticVerdictStatus = 'pass' | 'needs_fix' | 'unparseable';

export type DesignCriticIssueOwner =
    | 'requirement'
    | 'asset'
    | 'insight'
    | 'copy'
    | 'visual'
    | 'layout'
    | 'execution';

export interface DesignCriticIssue {
    /**
     * 评审问题归属，用于把返工交回最合适的队友。
     * 这是流水线协作字段，不是用户可见的工程状态。
     */
    owner?: DesignCriticIssueOwner;
    /** 问题对象（图层/模块/文案等） */
    target: string;
    problem: string;
    suggestion: string;
}

/**
 * 确定性评分卡摘要（并进评审裁决时随附）。
 * gate 取值与 design-quality-assertion 的 DesignScorecardGate 对齐；
 * 此处内联字面量联合，避免 types ↔ design-quality-assertion 的循环依赖。
 */
export interface DesignCriticDeterministicScorecard {
    /** 0..100，已评估断言的加权得分 */
    overallScore: number;
    gate: 'passed' | 'failed' | 'needs_review' | 'incomplete_verification' | 'insufficient_observations';
    /** 已被真实测量评估的断言数 / 断言总数 */
    evaluated: number;
    total: number;
    summary: string;
}

export interface DesignCriticVerdict {
    status: DesignCriticVerdictStatus;
    issues: DesignCriticIssue[];
    /** 评审报告原文（裁决 JSON 之外的部分） */
    reviewText: string;
    /**
     * 确定性评分卡摘要：由流水线真实工具结果测量得出（design-quality-assertion 确定性断言）。
     * 存在即表示其失败/待复核断言已并入 issues，且确定性失败不允许被模型散文结论抵消。
     */
    deterministicScorecard?: DesignCriticDeterministicScorecard;
}

// ==================== 团队流水线 ====================

export interface DesignTeamPipelineStageRecord {
    stage: string;
    role: DesignTeammateRole;
    success: boolean;
    message: string;
    iterations: number;
    toolsUsed: string[];
    error?: string;
}

export interface DesignTeamPipelineResult {
    success: boolean;
    /** 给主循环/用户的最终汇总 */
    message: string;
    goal: string;
    stages: DesignTeamPipelineStageRecord[];
    verdict?: DesignCriticVerdict;
    /** 实际执行的修订轮数 */
    revisionRounds: number;
    cancelled?: boolean;
    error?: string;
}
