/**
 * Reflexion 重入决策（纯逻辑，可 smoke）。
 *
 * 背景：v3/v5 在一次运行结束、质量门禁未通过时，已经会生成 ReflexionHandoff
 * （failureAnalysis + strategyAdjustments + nextRoundConstraints，reenterLoop:'react'）。
 * 这份「下一轮约束」由 executor 外层的重入循环消费（见 autonomous-agent.executor.ts 的 reflexion
 * 重入循环：取 reflexionHandoff + 各轮评分卡 → decideQualityAwareReflexionReentry → 带约束重跑），
 * 闭环已闭合。
 *
 * 本模块只做一件事：给定一次运行的 ReflexionHandoff、重入历史与（可选的）各轮质量评分卡，
 * **确定性地**判断「是否应该带着约束自动重跑一轮，以及注入什么约束」。它不发起重跑、不调模型、
 * 不碰运行时，因此可被 smoke 完整验证；实际重入接线（executor 外层）单独实现。
 *
 * 设计原则（对齐「外层 Workflow State Machine + 内层 Bounded ReAct」）：
 * - 重入是「阶段产出后审核失败 → 带约束重跑」，不是轮内工具门禁（不拦截任何工具调用）。
 * - 必须有硬护栏防止自动重跑失控：重入上限、取消、无进展即停。
 *
 * 单一停机口径（2026-07 合流，用户拍板：A7↔A8 质量返工 ≤3 轮、超限升级人工）：
 * - 基础策略 decideReflexionReentry 保守上限仍为 ≤1；仅当 creative_design 有各轮评分卡历史
 *   且「质量分在涨」（最近一轮加权分 > 上一轮）时，decideQualityAwareReflexionReentry 才把
 *   重入上限放宽到 ≤3；无进展（失败签名相同）仍即停，不受涨分放宽。
 * - 与 design-quality-assertion 的停机控制器 evaluateQualityLoopDecision（轮数预算 + 停涨止损 +
 *   检查信息不足时补测量/画面观察 + 红线转人工）取【更严格】者：任一说停即停。
 * - escalate_human / stop_max_rounds 由接线层向用户诚实说明卡点与各轮分数轨迹，不伪造完成。
 * - 本模块只控制「停 / 继续返工」，不重拼 pass/fail 裁决——裁决单一口径仍是
 *   design-quality-verdict-bundle 的 buildDesignVerdict。
 */

import {
    evaluateQualityLoopDecision,
    type DesignScorecard,
    type QualityLoopDecision
} from './design-quality-assertion';

export interface ReflexionHandoffLike {
    status: 'reflexion_required' | 'not_required' | string;
    failureAnalysis?: string[];
    strategyAdjustments?: string[];
    nextRoundConstraints?: string[];
    targetStage?: string;
}

export interface ReflexionReentryInput {
    /** 本次运行结束产生的 reflexion handoff（可能不存在）。 */
    handoff?: ReflexionHandoffLike | null;
    /** 此前已自动重入的次数（首次运行为 0）。 */
    priorReentryCount: number;
    /** 自动重入上限（保守默认见 DEFAULT_MAX_REFLEXION_REENTRIES）。 */
    maxReentries: number;
    /** 用户是否已取消。 */
    cancelled?: boolean;
    /** 上一轮重入时的失败签名（用于「无进展即停」判断）。 */
    previousFailureSignature?: string;
    /** 当前运行已经由循环护栏判定无进展时，不得再自动重跑原任务。 */
    stopReason?: string;
}

export interface ReflexionReentryDecision {
    shouldReenter: boolean;
    /** 机器可读原因码，便于 UI / smoke / 遥测。quality_halt 仅由合流决策（quality-aware）返回。 */
    reason:
        | 'no_handoff'
        | 'not_required'
        | 'cancelled'
        | 'max_reentries_reached'
        | 'no_actionable_constraints'
        | 'no_progress'
        | 'planning_owner_required'
        | 'reentry'
        | 'quality_halt';
    /** 注入下一轮的约束（仅 shouldReenter 时非空）。 */
    injectedConstraints: string[];
    /** 本轮失败签名（用于下一轮的无进展判断）。 */
    failureSignature: string;
    /** 若重入，这是第几次（priorReentryCount + 1）。 */
    reentryCount: number;
}

/** 保守默认：一次运行后最多自动复盘重跑 1 轮，避免失控空转与成本累积。 */
export const DEFAULT_MAX_REFLEXION_REENTRIES = 1;

export interface WarningOnlyNeedsReviewInput {
    status?: string;
    blockers?: readonly unknown[];
}

/**
 * `needs_review` 表示现有产物需要人工或画面复核，并不等同于质量失败。
 * 当没有 blocker 时，把原始任务从头重放会重复 mutation，还可能用第二轮失败覆盖首轮成果；
 * 这种结果应作为诚实的终态复核边界返回。真正的 failed/blocker 仍可生成 Reflexion handoff。
 */
export function isWarningOnlyNeedsReviewTerminal(input: WarningOnlyNeedsReviewInput): boolean {
    if (String(input.status || '').trim() !== 'needs_review') return false;
    return !(input.blockers || []).some((item) => String(item || '').trim().length > 0);
}

function compact(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeNonEmpty(values: Array<string | undefined | null>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
        const text = compact(v);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
    }
    return out;
}

/** 失败签名：把失败分析 + 约束规整成稳定字符串，用于判断两轮是否在原地打转。 */
export function buildReflexionFailureSignature(handoff?: ReflexionHandoffLike | null): string {
    if (!handoff) return '';
    const parts = dedupeNonEmpty([
        ...(handoff.failureAnalysis || []),
        ...(handoff.nextRoundConstraints || [])
    ]);
    return parts.join(' | ');
}

/**
 * 确定性判断是否带约束自动重入。任一护栏命中即不重入，并给出原因码。
 */
export function decideReflexionReentry(input: ReflexionReentryInput): ReflexionReentryDecision {
    const handoff = input.handoff || undefined;
    const failureSignature = buildReflexionFailureSignature(handoff);
    const baseDecision = {
        injectedConstraints: [] as string[],
        failureSignature,
        reentryCount: input.priorReentryCount
    };

    if (!handoff) {
        return { shouldReenter: false, reason: 'no_handoff', ...baseDecision };
    }
    if (handoff.status !== 'reflexion_required') {
        return { shouldReenter: false, reason: 'not_required', ...baseDecision };
    }
    if (input.cancelled === true) {
        return { shouldReenter: false, reason: 'cancelled', ...baseDecision };
    }
    if (String(handoff.targetStage || '').trim() === 'R0') {
        return { shouldReenter: false, reason: 'planning_owner_required', ...baseDecision };
    }
    if (input.stopReason === 'no_progress') {
        return { shouldReenter: false, reason: 'no_progress', ...baseDecision };
    }
    if (input.priorReentryCount >= Math.max(0, input.maxReentries)) {
        return { shouldReenter: false, reason: 'max_reentries_reached', ...baseDecision };
    }

    const constraints = dedupeNonEmpty([
        ...(handoff.nextRoundConstraints || []),
        ...(handoff.strategyAdjustments || [])
    ]);
    if (constraints.length === 0) {
        // 没有可执行的下一轮约束 —— 重跑也没有新方向，不重入。
        return { shouldReenter: false, reason: 'no_actionable_constraints', ...baseDecision };
    }

    // 无进展即停：本轮失败签名与上一轮重入时相同，说明在原地打转。
    if (
        input.previousFailureSignature
        && failureSignature
        && input.previousFailureSignature === failureSignature
    ) {
        return { shouldReenter: false, reason: 'no_progress', ...baseDecision };
    }

    return {
        shouldReenter: true,
        reason: 'reentry',
        injectedConstraints: constraints,
        failureSignature,
        reentryCount: input.priorReentryCount + 1
    };
}

/**
 * 把重入决策转成注入下一轮 ReAct 的约束消息文本（中文，供 Agent 作为新一轮起点）。
 * 仅在 shouldReenter 时调用有意义。
 */
export function buildReflexionReentryMessage(
    handoff: ReflexionHandoffLike,
    decision: ReflexionReentryDecision
): string {
    const failureAnalysis = dedupeNonEmpty(handoff.failureAnalysis || []);
    const lines: string[] = [
        `这是上一轮处理后的自我复盘结果（第 ${decision.reentryCount} 次返工，请据此改进，不要重复同样的问题）：`
    ];
    if (failureAnalysis.length) {
        lines.push('未通过的原因：');
        failureAnalysis.forEach((item) => lines.push(`- ${item}`));
    }
    lines.push('下一轮必须满足的约束：');
    decision.injectedConstraints.forEach((item) => lines.push(`- ${item}`));
    return lines.join('\n');
}

// ==================== 合流：质量感知的单一停机口径（2026-07） ====================

/**
 * 质量分在涨时的自动返工上限（用户拍板：A7↔A8 质量返工 ≤3 轮、超限升级人工）。
 * 仅经 decideQualityAwareReflexionReentry 且「最近一轮加权分 > 上一轮」时生效；
 * 基础策略 decideReflexionReentry 的保守默认（≤1）不变。
 */
export const QUALITY_IMPROVING_MAX_REFLEXION_REENTRIES = 3;

/** 质量口径要求停机时的停机类别（供接线层决定文案与是否转人工）。 */
export type QualityLoopHaltKind = 'stop_pass' | 'stop_no_progress' | 'escalate_human' | 'stop_max_rounds';

export interface QualityAwareReentryInput {
    /** 本次运行结束产生的 reflexion handoff（可能不存在）。 */
    handoff?: ReflexionHandoffLike | null;
    /** 此前已自动重入的次数（首次运行为 0）。 */
    priorReentryCount: number;
    /** 用户是否已取消。 */
    cancelled?: boolean;
    /** 上一轮重入时的失败签名（用于「无进展即停」判断）。 */
    previousFailureSignature?: string;
    /** 当前运行已经由循环护栏判定无进展时，不得再自动重跑原任务。 */
    stopReason?: string;
    /**
     * 各轮质量评分卡历史（按时间顺序；仅 creative_design 且该轮真评出分才有条目）。
     * 空/缺省 → 完全退回基础重入策略（≤1、签名无进展即停）。
     */
    scorecardHistory?: DesignScorecard[];
    /** 无评分卡历史 / 分数没在涨时的基础重入上限，默认 DEFAULT_MAX_REFLEXION_REENTRIES。 */
    baseMaxReentries?: number;
}

export interface QualityAwareReentryDecision extends ReflexionReentryDecision {
    /** 质量停机控制器的裁决（有评分历史时才有）；仅供停机说明/诊断，不重拼 pass/fail 裁决。 */
    qualityDecision?: QualityLoopDecision;
    /** 质量口径（或触顶等价语义）要求停机时的停机类别；escalate_human/stop_max_rounds 须向用户诚实说明。 */
    qualityHalt?: QualityLoopHaltKind;
    /** 各轮加权总分轨迹（0..100，供诚实失败文案展示）。 */
    scoreTrajectory: number[];
    /** 本轮实际生效的重入上限（涨分=QUALITY_IMPROVING_MAX_REFLEXION_REENTRIES，其余=基础上限）。 */
    effectiveMaxReentries: number;
}

/**
 * 单一停机口径：把基础重入护栏（decideReflexionReentry）与质量停机控制器
 * （evaluateQualityLoopDecision）合并，取【更严格】者——任一说停即停。
 *
 * - 无评分卡历史 → 完全退回基础策略（上限 ≤1），行为与旧接线一致。
 * - 有评分卡历史：
 *   - 「质量分在涨」（最近一轮 > 上一轮）时把重入上限放宽到 ≤3；首轮无可比对象、
 *     停涨/跌分不放宽（保持 ≤1）。
 *   - 质量口径的轮数预算含首轮评分：返工 ≤3 轮 ⇔ 评分轮 ≤4，故传 maxRounds = 上限 + 1；
 *     真正的返工计数以基础策略的 priorReentryCount 为权威，两者取更严格者。
 *   - 无进展（失败签名与上一轮相同）仍即停，不受涨分放宽（治原地打转）。
 * - 本函数只判「停 / 继续返工」并给出停机类别与分数轨迹；不改变运行结果的成败裁决。
 */
export function decideQualityAwareReflexionReentry(input: QualityAwareReentryInput): QualityAwareReentryDecision {
    const history = Array.isArray(input.scorecardHistory)
        ? input.scorecardHistory.filter((card): card is DesignScorecard => Boolean(card))
        : [];
    const scoreTrajectory = history.map((card) => card.overallScore);
    const baseMax = Math.max(0, input.baseMaxReentries ?? DEFAULT_MAX_REFLEXION_REENTRIES);

    // 无评分历史（非 creative_design 或没真评过分）：完全退回基础重入策略，不引入质量口径。
    if (history.length === 0) {
        const base = decideReflexionReentry({
            handoff: input.handoff,
            priorReentryCount: input.priorReentryCount,
            maxReentries: baseMax,
            cancelled: input.cancelled,
            previousFailureSignature: input.previousFailureSignature,
            stopReason: input.stopReason
        });
        return { ...base, scoreTrajectory, effectiveMaxReentries: baseMax };
    }

    // 涨分放宽：仅最近一轮加权分严格高于上一轮时，把上限提到 ≤3（用户拍板语义）。
    const lastIndex = scoreTrajectory.length - 1;
    const improving = scoreTrajectory.length >= 2 && scoreTrajectory[lastIndex] > scoreTrajectory[lastIndex - 1];
    const effectiveMaxReentries = improving
        ? Math.max(baseMax, QUALITY_IMPROVING_MAX_REFLEXION_REENTRIES)
        : baseMax;

    const base = decideReflexionReentry({
        handoff: input.handoff,
        priorReentryCount: input.priorReentryCount,
        maxReentries: effectiveMaxReentries,
        cancelled: input.cancelled,
        previousFailureSignature: input.previousFailureSignature,
        stopReason: input.stopReason
    });
    // 轮数预算换算见函数头注释：质量口径的"轮"含首轮评分，返工 ≤N ⇔ 评分轮 ≤N+1。
    const qualityDecision = evaluateQualityLoopDecision(history, {
        maxRounds: QUALITY_IMPROVING_MAX_REFLEXION_REENTRIES + 1
    });

    const qualitySaysGoOn = qualityDecision.action === 'continue' || qualityDecision.action === 'gather_observations';
    if (!qualitySaysGoOn) {
        // 更严格者优先：质量口径说停即停（哪怕基础护栏还想继续）。
        return {
            shouldReenter: false,
            reason: base.shouldReenter ? 'quality_halt' : base.reason,
            injectedConstraints: [],
            failureSignature: base.failureSignature,
            reentryCount: input.priorReentryCount,
            qualityDecision,
            qualityHalt: qualityDecision.action as QualityLoopHaltKind,
            scoreTrajectory,
            effectiveMaxReentries
        };
    }

    if (!base.shouldReenter) {
        // 更严格者优先：基础护栏说停即停（取消/上限/无约束/签名无进展/无 handoff）。
        // 涨分放宽后仍触顶 = 达到用户拍板的返工上限，按 stop_max_rounds 语义向用户诚实交代。
        return {
            ...base,
            qualityDecision,
            qualityHalt: base.reason === 'max_reentries_reached' ? 'stop_max_rounds' : undefined,
            scoreTrajectory,
            effectiveMaxReentries
        };
    }

    // 双方都说继续 → 重入。沿用既有 buildDesignReflexionConstraints 约束注入：
    // qualityDecision.nextConstraints 即 buildDesignReflexionConstraints(最新评分卡).nextRoundConstraints，
    // 与 handoff 约束合并去重，不另造第二套约束语言。
    return {
        ...base,
        injectedConstraints: dedupeNonEmpty([
            ...base.injectedConstraints,
            ...(qualityDecision.nextConstraints || [])
        ]),
        qualityDecision,
        scoreTrajectory,
        effectiveMaxReentries
    };
}

/**
 * 质量停机（escalate_human / stop_max_rounds）时给用户的诚实失败说明（中文，纯函数）：
 * 说明卡点与各轮分数轨迹，不宣称完成，并指路可达动作（人工修正后复评 / 明确降低要求）。
 */
export function buildQualityLoopHaltMessage(input: {
    qualityHalt: QualityLoopHaltKind;
    /** 停机原因（一般取 qualityDecision.reason）。 */
    reason: string;
    scoreTrajectory: number[];
    /** 已自动返工的轮数。 */
    reentryCount: number;
    /** 最新一轮评分卡（用于列出仍未解决的卡点）；缺省则只报轨迹与原因。 */
    latestScorecard?: DesignScorecard | null;
}): string {
    const lines: string[] = [];
    const reason = compact(input.reason) || '质量返工停止条件已触发。';
    if (input.qualityHalt === 'escalate_human') {
        lines.push(`设计质量返工已停止，需人工裁决（已自动返工 ${input.reentryCount} 轮）：${reason}`);
    } else {
        lines.push(`设计质量返工已达上限（已自动返工 ${input.reentryCount} 轮）：${reason}`);
    }
    if (input.scoreTrajectory.length) {
        const trajectory = input.scoreTrajectory
            .map((score, index) => `第 ${index + 1} 轮 ${score} 分`)
            .join(' → ');
        lines.push(`各轮质量评分轨迹：${trajectory}。`);
    }
    const latest = input.latestScorecard;
    if (latest) {
        const stuckItems = [...latest.blockers, ...latest.failedAssertions]
            .filter((item, index, arr) => arr.findIndex((x) => x.id === item.id) === index)
            .slice(0, 3);
        if (stuckItems.length) {
            lines.push('仍未解决的卡点：');
            stuckItems.forEach((item) => {
                lines.push(`- ${item.rationale}（建议：${item.expectedFix}）`);
            });
        }
    }
    lines.push('本任务未按质量标准完成，不作完成宣称。你可以：在 Photoshop 里按上述建议手动修正后让我重新评审；或明确降低质量要求，我再按新标准收尾。');
    return lines.join('\n');
}
