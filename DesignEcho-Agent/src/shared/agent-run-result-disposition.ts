export type AgentRunResultDisposition =
    | 'ignore_stale_result'
    | 'project_cancelled_result'
    | 'reject_result_after_stop'
    | 'process_active_result';

export interface AgentRunResultDispositionInput {
    isActiveRun: boolean;
    runCancelled: boolean;
    resultCancelled: boolean;
}

/**
 * Decides whether a completed Agent call may update the active UI run.
 * A cancelled result from the same run remains readable so its bounded
 * execution/task projection can settle an already-visible stop message.
 */
export function decideAgentRunResultDisposition(
    input: AgentRunResultDispositionInput
): AgentRunResultDisposition {
    if (!input.isActiveRun) return 'ignore_stale_result';
    if (input.resultCancelled) return 'project_cancelled_result';
    if (input.runCancelled) return 'reject_result_after_stop';
    return 'process_active_result';
}
