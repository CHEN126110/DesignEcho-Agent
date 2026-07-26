/**
 * Agent 工具并行执行策略（纯逻辑，可被 smoke 直接测试）
 *
 * 模型一轮内发起多个工具调用时，把【连续的并行安全调用】合并为并发批次，
 * 其余严格串行。批次保持原始顺序——写类调用执行前能看到此前全部结果
 * （读后写预检依赖 toolCallLog 中的前序读取结果）。
 *
 * 并行安全的判定：
 * - read_only_observation / knowledge_search / external_generation 类工具
 * - delegateToAgent 且角色为只读队友（不写 Photoshop 的子 Agent，
 *   其收益主要是模型调用相互重叠；Photoshop 侧读操作由 executeAsModal 自然排队）
 * - photoshop_write / save_export / stateful_context / unknown 一律串行
 */

import { classifyAgentToolExecution } from './agent-tool-execution-preflight';
import type { DesignTeammateRole } from './types/design-team.types';

/**
 * 只读队友角色（与 design-teams/registry.ts 的 canWriteToPhotoshop:false 对应；
 * smoke-design-team-pipeline.cjs 会交叉校验两处一致，防止漂移）
 */
export const PARALLEL_SAFE_TEAMMATE_ROLES: ReadonlySet<DesignTeammateRole> = new Set([
    'scene-analyst',
    'market-researcher',
    'copywriter',
    'design-strategist',
    'critic'
] as DesignTeammateRole[]);

/** 单个并发批次的调用数上限 */
export const MAX_PARALLEL_TOOL_CALLS = 3;

export interface ParallelToolCallLike {
    name: string;
    arguments?: any;
}

export interface ToolCallBatch<T extends ParallelToolCallLike = ParallelToolCallLike> {
    /** true = 批内调用可并发执行 */
    parallel: boolean;
    calls: T[];
}

export function isParallelSafeToolCall(call: ParallelToolCallLike): boolean {
    const name = String(call?.name || '');
    if (!name) return false;

    if (name === 'delegateToAgent') {
        const role = String(call?.arguments?.role || '') as DesignTeammateRole;
        return PARALLEL_SAFE_TEAMMATE_ROLES.has(role);
    }

    const kind = classifyAgentToolExecution(name, call?.arguments);
    return kind === 'read_only_observation'
        || kind === 'knowledge_search'
        || kind === 'external_generation';
}

/**
 * 把一轮工具调用切分为保序批次：
 * 连续的并行安全调用合并（受 MAX_PARALLEL_TOOL_CALLS 限制），其余单调用串行。
 */
export function partitionToolCallsForParallelExecution<T extends ParallelToolCallLike>(
    toolCalls: T[],
    maxParallel: number = MAX_PARALLEL_TOOL_CALLS
): Array<ToolCallBatch<T>> {
    const batches: Array<ToolCallBatch<T>> = [];
    const cap = Math.max(1, maxParallel);

    for (const call of toolCalls || []) {
        const safe = isParallelSafeToolCall(call);
        const last = batches[batches.length - 1];
        if (safe && last && last.parallel && last.calls.length < cap) {
            last.calls.push(call);
        } else {
            batches.push({ parallel: safe, calls: [call] });
        }
    }

    // 单调用批次没有并发收益，归为串行执行路径
    for (const batch of batches) {
        if (batch.calls.length === 1) batch.parallel = false;
    }

    return batches;
}
