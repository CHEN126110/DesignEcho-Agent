/**
 * 自主 Agent 结果的无副作用外层投影。
 *
 * 取消不是“无结果”：Runtime 已形成的只读快照与执行诊断必须继续交给 UI，
 * 但它们不改变取消裁决，也不授予任何执行权限。
 */

import type { AgentRunResult } from '../agent-runtime/types';
import type { AgentResult } from '../unified-agent.service';
import { readRuntimeTaskSnapshot } from '../../../shared/agent-runtime-v5/runtime-task-snapshot';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function buildCancelledAutonomousAgentResult(result: AgentRunResult): AgentResult {
    const runtimeTaskSnapshot = isRecord(result.data)
        ? readRuntimeTaskSnapshot(result.data.runtimeTaskSnapshot)
        : undefined;
    return {
        success: false,
        message: '任务已取消。',
        cancelled: true,
        data: {
            iterations: result.iterations,
            ...(result.stopReason ? { stopReason: result.stopReason } : {}),
            ...(result.executionSummary ? { executionSummary: result.executionSummary } : {}),
            ...(runtimeTaskSnapshot ? { runtimeTaskSnapshot } : {})
        }
    };
}
