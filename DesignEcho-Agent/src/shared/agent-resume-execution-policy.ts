import type {
    AgentResumableTaskContract,
    AgentResumableTaskStatus
} from './agent-resumable-task-contract';

export type AgentResumeExecutionPolicyVersion = 'agent-resume-execution-policy/v0';

export type AgentResumeExecutionPolicyAction =
    | 'ignore'
    | 'reply_with_context'
    | 'block_and_explain'
    | 'request_fresh_context_before_resume'
    | 'resume_candidate_needs_model_decision';

export interface AgentResumeExecutionPolicy {
    version: AgentResumeExecutionPolicyVersion;
    sourceStatus: AgentResumableTaskStatus;
    action: AgentResumeExecutionPolicyAction;
    shouldAutoExecute: false;
    shouldRunPhotoshop: false;
    mayCallModelForUserReply: boolean;
    requiresFreshPhotoshopContext: boolean;
    requiresExplicitExecutionPlan: boolean;
    requiresUserClarification: boolean;
    userFacingSummary: string;
    blockers: string[];
    warnings: string[];
    controlContextOnly: true;
    writesPerformed: false;
    mustNotClaimTaskCompletion: true;
}

function buildPolicy(
    contract: AgentResumableTaskContract,
    input: {
        action: AgentResumeExecutionPolicyAction;
        mayCallModelForUserReply?: boolean;
        requiresFreshPhotoshopContext?: boolean;
        requiresExplicitExecutionPlan?: boolean;
        requiresUserClarification?: boolean;
        userFacingSummary: string;
        blockers?: string[];
        warnings?: string[];
    }
): AgentResumeExecutionPolicy {
    return {
        version: 'agent-resume-execution-policy/v0',
        sourceStatus: contract.status,
        action: input.action,
        shouldAutoExecute: false,
        shouldRunPhotoshop: false,
        mayCallModelForUserReply: input.mayCallModelForUserReply === true,
        requiresFreshPhotoshopContext: input.requiresFreshPhotoshopContext === true,
        requiresExplicitExecutionPlan: input.requiresExplicitExecutionPlan === true,
        requiresUserClarification: input.requiresUserClarification === true,
        userFacingSummary: input.userFacingSummary,
        blockers: input.blockers || contract.blockers || [],
        warnings: input.warnings || contract.warnings || [],
        controlContextOnly: true,
        writesPerformed: false,
        mustNotClaimTaskCompletion: true
    };
}

export function buildAgentResumeExecutionPolicy(
    contract: AgentResumableTaskContract
): AgentResumeExecutionPolicy {
    switch (contract.status) {
        case 'not_requested':
            return buildPolicy(contract, {
                action: 'ignore',
                userFacingSummary: '当前请求不是恢复上一轮任务。',
                mayCallModelForUserReply: false
            });

        case 'blocked_no_history':
            return buildPolicy(contract, {
                action: 'block_and_explain',
                userFacingSummary: '缺少上一轮对话历史，不能仅凭“继续”恢复任务。',
                requiresUserClarification: true,
                mayCallModelForUserReply: true
            });

        case 'ready_for_model_contextual_reply':
            return buildPolicy(contract, {
                action: 'reply_with_context',
                userFacingSummary: '只能让模型基于对话上下文解释下一步，不能自动执行 Photoshop。',
                mayCallModelForUserReply: true
            });

        case 'blocked_last_turn_not_executable':
            return buildPolicy(contract, {
                action: 'block_and_explain',
                userFacingSummary: '上一轮不是可恢复的 Photoshop 执行任务，需要用户提出新的明确目标。',
                mayCallModelForUserReply: true
            });

        case 'blocked_last_turn_completed':
            return buildPolicy(contract, {
                action: 'block_and_explain',
                userFacingSummary: '上一轮任务已经完成，继续前需要新的修改目标。',
                requiresUserClarification: true,
                mayCallModelForUserReply: true
            });

        case 'blocked_last_turn_failed':
            return buildPolicy(contract, {
                action: 'block_and_explain',
                userFacingSummary: '上一轮任务失败，继续前需要先根据失败原因制定恢复动作。',
                requiresExplicitExecutionPlan: true,
                mayCallModelForUserReply: true
            });

        case 'blocked_missing_execution_context':
            return buildPolicy(contract, {
                action: 'request_fresh_context_before_resume',
                userFacingSummary: '继续前必须重新读取当前 Photoshop 和项目状态。',
                requiresFreshPhotoshopContext: true,
                requiresExplicitExecutionPlan: true,
                mayCallModelForUserReply: true
            });

        case 'candidate_for_execution_resume':
            return buildPolicy(contract, {
                action: 'resume_candidate_needs_model_decision',
                userFacingSummary: '这是可恢复候选，但仍需要模型重新确认目标、上下文和执行计划。',
                requiresFreshPhotoshopContext: true,
                requiresExplicitExecutionPlan: true,
                mayCallModelForUserReply: true,
                warnings: [
                    ...contract.warnings,
                    '策略禁止直接自动恢复执行；必须先形成新的明确执行计划。'
                ]
            });

        default:
            return buildPolicy(contract, {
                action: 'block_and_explain',
                userFacingSummary: '恢复任务状态无法识别，已阻断自动执行。',
                requiresUserClarification: true,
                mayCallModelForUserReply: true,
                blockers: ['未知恢复任务状态。']
            });
    }
}
