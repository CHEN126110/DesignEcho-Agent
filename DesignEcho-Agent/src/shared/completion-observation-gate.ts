/**
 * 完成观察门禁（纯逻辑，可 smoke）。
 *
 * 目标：治「幻觉式完成」——一次 autonomous run 改了画面/文件（有 mutation），却没有最后一次
 * 成功画布修改之后的观察（修改前读取或两次修改之间的读取都不能验证最终版本），此时不得把结果
 * 宣称为 completed，应降级为 needs_review。
 * 从「仅设计纪律 active」推广到所有 autonomous run。
 *
 * 关键红线（红线1）：本门禁触发的降级必须是【终态】——不得据此生成 Reflexion handoff、不得进入
 * executor 的自动重入循环、绝不重放原任务、绝不重复 mutation（否则会把"复制这个图层"重跑成复制两次，
 * 正是项目记忆 system-refactor-432 记的病灶）。因此 decision.terminal 与 downgrade 同真：调用方据此
 * 短路 handoff 与重跑。本模块不发起降级动作、不改运行时，只做确定性判定，可被 smoke 完整验证。
 *
 * 窄范围（红线2，用户拍板）：只降级「多步/写入类 mutation 且零观察」。豁免两类：
 *  1) export-only run：本轮 mutation 全是 save_export（quickExport / exportMainImageDocuments 等，
 *     无前置读语义），与 V0-6「导出=只读」一致，不算幻觉式完成。
 *  2) 单个自验证的简单机械 mutation（renameLayer / setLayerOpacity 等，见 preflight 的
 *     SIMPLE_MECHANICAL_GUARDED_TOOLS）：单步机械操作可自验证，不构成幻觉式完成风险。
 *
 * 观察判定口径（红线3）：必须用 classifyAgentToolExecution(name, arguments)（带参数），与 mutation
 * 判定同口径——否则 inspect 模式技能（layer-management action:'inspect'、skuLayout
 * action:'listLayerSets'）会被漏算为观察。本模块直接复用 preflight 的分类器与豁免白名单，单一事实源。
 */

import {
    classifyAgentToolExecution,
    isAgentPhotoshopDocumentObservation,
    isAgentToolExecutionGuarded,
    SIMPLE_MECHANICAL_GUARDED_TOOLS
} from './agent-tool-execution-preflight';
import {
    buildAgentOperationDocumentTimeline,
    sameAgentOperationDocumentContext
} from './agent-operation-document-timeline';

export interface CompletionObservationGateToolCall {
    name: string;
    arguments?: any;
    result?: any;
    /** 该工具调用是否成功（result.success !== false）；缺省视为成功。失败调用不计观察也不计 mutation。 */
    succeeded?: boolean;
}

export type CompletionObservationGateReason =
    | 'no_mutation'
    | 'export_only'
    | 'single_self_verifying_mechanical'
    | 'has_observation'
    | 'mutation_without_observation';

export interface CompletionObservationGateDecision {
    /** 是否应把「看似完成」降级为需复核（有改画面/文件却零观察）。 */
    downgrade: boolean;
    /** 该降级是否为终态（抑制 reflexion handoff / 不重跑）。与 downgrade 同真——本门禁的降级恒为终态。 */
    terminal: boolean;
    reason: CompletionObservationGateReason;
    /** 成功的写入/导出类 mutation 次数（photoshop_write | save_export）。 */
    mutationCount: number;
    /** 最后一次成功画布修改之后的观察次数；无画布修改时为本轮成功观察数。 */
    observationCount: number;
    /** 触发计数的 mutation 工具名（去重，用于诚实说明）。 */
    mutationTools: string[];
}

function normalizeName(value: unknown): string {
    return String(value || '').trim();
}

/**
 * 确定性判定：给定一次运行的工具调用序列（含参数与成败），是否应把「看似完成」降级为需复核，
 * 以及该降级是否为终态。任一豁免命中即不降级，并给出机器可读原因码。
 */
export function evaluateCompletionObservationGate(
    toolCalls: CompletionObservationGateToolCall[]
): CompletionObservationGateDecision {
    let observationCount = 0;
    let mutationCount = 0;
    /** 写入类（photoshop_write）mutation 次数——不含 save_export，用于区分 export-only。 */
    let writeMutationCount = 0;
    /** 机械写入只有在 Tool 本身成功时才可视为自验证；失败后检测到改动仍需读回复核。 */
    let allWriteMutationsSucceeded = true;
    const mutationTools: string[] = [];
    const writeMutationTools: string[] = [];
    const calls = Array.isArray(toolCalls) ? toolCalls : [];
    const timeline = buildAgentOperationDocumentTimeline(calls);
    let latestWriteMutationIndex = -1;

    for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index];
        const name = normalizeName(call?.name);
        if (!name) continue;
        const timelineEntry = timeline.entries[index];
        // 红线3：带 arguments 分类，inspect 模式技能才会被正确判为 read_only_observation（观察）。
        const kind = classifyAgentToolExecution(name, call?.arguments);
        if (timelineEntry?.succeeded
            && kind === 'read_only_observation'
            && isAgentPhotoshopDocumentObservation(name, call?.arguments)
            && (latestWriteMutationIndex < 0
                || sameAgentOperationDocumentContext(
                    timeline.entries[latestWriteMutationIndex],
                    timeline.entries[index]
                ))) {
            observationCount += 1;
            continue;
        }
        if (isAgentToolExecutionGuarded(name, call?.arguments)
            && (timelineEntry?.succeeded || timelineEntry?.photoshopMutationObserved)) {
            mutationCount += 1;
            mutationTools.push(name);
            if (kind !== 'save_export') {
                writeMutationCount += 1;
                writeMutationTools.push(name);
                if (!timelineEntry?.succeeded) allWriteMutationsSucceeded = false;
                latestWriteMutationIndex = index;
                // 此前观察只描述旧版本；从最后一次成功画布修改重新计数。
                observationCount = 0;
            }
        }
    }

    const uniqueMutationTools = Array.from(new Set(mutationTools));
    const noDowngrade = (reason: CompletionObservationGateReason): CompletionObservationGateDecision => ({
        downgrade: false,
        terminal: false,
        reason,
        mutationCount,
        observationCount,
        mutationTools: uniqueMutationTools
    });

    // 没有任何 mutation → 本门禁不适用（没改画面/文件，谈不上幻觉式完成）。
    if (mutationCount === 0) return noDowngrade('no_mutation');
    // 最后一次画布修改之后有观察 → 最终版本不是零观察，不降级。
    if (observationCount > 0) return noDowngrade('has_observation');
    // 零观察但 mutation 全是导出（quickExport / exportMainImageDocuments 等，导出=只读语义）→ 豁免（红线2）。
    if (writeMutationCount === 0) return noDowngrade('export_only');
    // 零观察且仅一个简单机械 mutation（renameLayer / setLayerOpacity 等，单步可自验证）→ 豁免（红线2）。
    // 走到这里 writeMutationCount >= 1，故 mutationCount===1 时那唯一 mutation 必是写入类。
    if (writeMutationCount === 1
        && allWriteMutationsSucceeded
        && SIMPLE_MECHANICAL_GUARDED_TOOLS.has(writeMutationTools[0])) {
        return noDowngrade('single_self_verifying_mechanical');
    }
    // 多步 / 非简单机械的写入类 mutation 且整轮零观察 → 降级为需复核，且为终态（抑制 reflexion 重跑）。
    return {
        downgrade: true,
        terminal: true,
        reason: 'mutation_without_observation',
        mutationCount,
        observationCount,
        mutationTools: uniqueMutationTools
    };
}
