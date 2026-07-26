import type { ExecutionCallbacks } from '../unified-agent.service';
import type { AgentStepEvent } from '../agent-runtime/types';
import { getToolDisplayInfo } from '../tool-display-info';

export function emitSkillStep(
    callbacks: ExecutionCallbacks | undefined,
    step: AgentStepEvent
): void {
    callbacks?.onStep?.({
        ...step,
        source: step.source || 'skill_executor',
        audience: step.audience || 'agent'
    });
}

export async function executeObservedSkillTool<TParams extends Record<string, any>, TResult>(
    callbacks: ExecutionCallbacks | undefined,
    toolName: string,
    params: TParams,
    execute: (toolName: string, params: TParams) => Promise<TResult>,
    detail?: string
): Promise<TResult> {
    const toolCallId = `skill-tool-${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toolLabel = getToolDisplayInfo(toolName).name || '处理步骤';

    emitSkillStep(callbacks, {
        kind: 'tool_started',
        title: `开始处理：${toolLabel}`,
        detail,
        status: 'running',
        toolName,
        toolCallId
    });

    try {
        const result = await execute(toolName, params);
        const success = (result as any)?.success !== false;
        emitSkillStep(callbacks, {
            kind: 'tool_completed',
            title: success ? `处理完成：${toolLabel}` : `处理未完成：${toolLabel}`,
            detail: success ? undefined : String((result as any)?.error || '处理返回失败状态'),
            status: success ? 'success' : 'error',
            toolName,
            toolCallId
        });
        return result;
    } catch (error) {
        emitSkillStep(callbacks, {
            kind: 'tool_completed',
            title: `处理异常：${toolLabel}`,
            detail: error instanceof Error ? error.message : String(error),
            status: 'error',
            toolName,
            toolCallId
        });
        throw error;
    }
}
