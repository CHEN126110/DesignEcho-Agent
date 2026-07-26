/**
 * Run Record Eval 底座（Harness v1 · H4）
 *
 * 两个能力，全部纯逻辑（CLI 脚本只做 IO 薄壳）：
 *  1. aggregateAgentRunMetrics：从运行档案聚合工具调用级指标——回答
 *     "工具选得对不对/哪个工具最常失败/失败码分布/停机原因分布/质量硬拦率"，
 *     把评估从"最终回答好不好"下沉到"哪一步坏了"（技术参考包 Ch12 的层级）。
 *  2. buildRegressionCaseFromRunRecord：把一次失败运行转成回归用例骨架
 *     （目标/路由/复现要点/当时卡点/期望与禁止行为待人工补全）——
 *     "每次线上失败都应转成 regression case"的机制化。
 */

import type { AgentRunRecord } from './agent-run-record';

export interface ToolMetric {
    name: string;
    calls: number;
    failures: number;
    /** 0..1，保留两位 */
    failureRate: number;
    /** 失败码 → 次数（最多 6 个高频码） */
    topFailureCodes: Record<string, number>;
}

export interface AgentRunMetrics {
    version: 'agent-run-metrics/v0';
    runCount: number;
    successRuns: number;
    /** 未完成形态（success=false 或取消）的运行数 */
    unfinishedRuns: number;
    totalToolCalls: number;
    writeToolCalls: number;
    avgIterations: number;
    /** 停机原因 → 次数 */
    stopReasons: Record<string, number>;
    /** 质量硬拦（designQualityHardBlocked）出现的运行数 */
    qualityHardBlockedRuns: number;
    /** 按失败率降序的工具指标（至少 1 次调用才入榜） */
    tools: ToolMetric[];
    /** 失败次数最多的前 5 个工具名（快速导航） */
    worstTools: string[];
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export function aggregateAgentRunMetrics(records: AgentRunRecord[] | null | undefined): AgentRunMetrics {
    const runs = (Array.isArray(records) ? records : []).filter(
        (record) => record && record.version === 'agent-run-record/v0'
    );
    const toolMap = new Map<string, { calls: number; failures: number; codes: Map<string, number> }>();
    const stopReasons: Record<string, number> = {};
    let totalToolCalls = 0;
    let writeToolCalls = 0;
    let iterationsSum = 0;
    let successRuns = 0;
    let unfinishedRuns = 0;
    let qualityHardBlockedRuns = 0;

    for (const run of runs) {
        iterationsSum += Number(run.iterations) || 0;
        if (run.success === true) successRuns += 1;
        if (run.success !== true || run.cancelled === true) unfinishedRuns += 1;
        if (run.quality?.hardBlocked === true) qualityHardBlockedRuns += 1;
        const stopKey = run.cancelled === true ? 'cancelled' : String(run.stopReason || 'unknown');
        stopReasons[stopKey] = (stopReasons[stopKey] || 0) + 1;

        for (const call of run.toolCalls || []) {
            totalToolCalls += 1;
            if (call.riskClass === 'write') writeToolCalls += 1;
            const entry = toolMap.get(call.name) || { calls: 0, failures: 0, codes: new Map<string, number>() };
            entry.calls += 1;
            if (!call.success) {
                entry.failures += 1;
                const code = String(call.code || 'no_code');
                entry.codes.set(code, (entry.codes.get(code) || 0) + 1);
            }
            toolMap.set(call.name, entry);
        }
    }

    const tools: ToolMetric[] = Array.from(toolMap.entries())
        .map(([name, entry]) => ({
            name,
            calls: entry.calls,
            failures: entry.failures,
            failureRate: entry.calls > 0 ? round2(entry.failures / entry.calls) : 0,
            topFailureCodes: Object.fromEntries(
                Array.from(entry.codes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)
            )
        }))
        .sort((a, b) => b.failureRate - a.failureRate || b.failures - a.failures);

    const worstTools = tools
        .filter((tool) => tool.failures > 0)
        .sort((a, b) => b.failures - a.failures)
        .slice(0, 5)
        .map((tool) => tool.name);

    return {
        version: 'agent-run-metrics/v0',
        runCount: runs.length,
        successRuns,
        unfinishedRuns,
        totalToolCalls,
        writeToolCalls,
        avgIterations: runs.length > 0 ? round2(iterationsSum / runs.length) : 0,
        stopReasons,
        qualityHardBlockedRuns,
        tools,
        worstTools
    };
}

// ── 失败运行 → 回归用例骨架 ──

export interface RegressionCaseSkeleton {
    version: 'agent-regression-case/v0';
    caseId: string;
    sourceRunId: string;
    title: string;
    input: {
        goal: string;
        route?: string;
        skillId?: string;
        projectPathHint?: string;
    };
    reproduction: {
        stopReason?: string;
        cancelled?: boolean;
        iterations: number;
        failedToolSteps: Array<{ seq: number; name: string; code?: string; summary: string }>;
        blockersAtFailure: string[];
    };
    /** 待人工补全——骨架不臆造期望，留空并给填写指引 */
    expected: {
        successCriteria: string[];
        requiredToolBehaviors: string[];
        forbiddenBehaviors: string[];
        note: string;
    };
}

export function buildRegressionCaseFromRunRecord(
    record: AgentRunRecord | null | undefined
): { ok: true; skeleton: RegressionCaseSkeleton } | { ok: false; reason: string } {
    if (!record || record.version !== 'agent-run-record/v0') {
        return { ok: false, reason: '不是合法的 agent-run-record/v0 档案' };
    }
    if (record.success === true && record.cancelled !== true) {
        return { ok: false, reason: '该运行已成功收尾——回归用例应来自失败/未完成运行（成功案例走金标集另立）' };
    }
    const failedSteps = (record.toolCalls || [])
        .filter((call) => !call.success)
        .slice(0, 10)
        .map((call) => ({
            seq: call.seq,
            name: call.name,
            ...(call.code ? { code: call.code } : {}),
            summary: call.summary
        }));

    return {
        ok: true,
        skeleton: {
            version: 'agent-regression-case/v0',
            caseId: `regression-${record.runId}`,
            sourceRunId: record.runId,
            title: `回归：${(record.goal || '未记录目标').slice(0, 60)}（${record.cancelled ? '取消' : record.stopReason || '未完成'}）`,
            input: {
                goal: record.goal,
                ...(record.decision?.route ? { route: record.decision.route } : {}),
                ...(record.decision?.skillId ? { skillId: record.decision.skillId } : {}),
                ...(record.projectPath ? { projectPathHint: record.projectPath } : {})
            },
            reproduction: {
                ...(record.stopReason ? { stopReason: record.stopReason } : {}),
                ...(record.cancelled === true ? { cancelled: true } : {}),
                iterations: record.iterations,
                failedToolSteps: failedSteps,
                blockersAtFailure: (record.blockers || []).slice(0, 5)
            },
            expected: {
                successCriteria: [],
                requiredToolBehaviors: [],
                forbiddenBehaviors: [],
                note: '待人工补全：本骨架只如实记录失败现场，不臆造期望行为。'
                    + '请填写成功标准（可验收的产物/状态）、必须发生的工具行为（如"先 inspectTemplateLayout 再 skuLayout"）、'
                    + '禁止行为（如"不得在缺模板时直接出图"），然后纳入回归集。'
            }
        }
    };
}
