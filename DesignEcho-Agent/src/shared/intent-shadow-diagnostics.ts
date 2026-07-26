/**
 * 意图影子对比诊断（纯逻辑，可 smoke）。
 *
 * V2「意图交给 Agent 理解」P1：在**不改变任何真实激活行为**的前提下，把"若以模型自主声明作纪律激活
 * 主判据会怎样"与"当前真实激活（关键词门 OR 行为足迹）实际怎样"逐次工具调用影子对比并记录分歧，
 * 供后续 P3 翻转前的客观决策（样本量 + 分歧率）。本模块只做确定性判定、绝不发起激活、无副作用。
 *
 * 关键性质：真实侧与影子侧**都包含行为足迹**（footprint 对两侧可见），二者唯一差异是"模型声明"。
 * 因此 shadow.active && !real.active 恒等价于"模型声明会激活、而关键词门与足迹都还没激活"——正是
 * 关键词门漏判（如"做促销海报"夹形容词漏判）且尚未动手的早窗口样本，即 earlier_activation。
 */

export type IntentShadowDivergenceKind =
    /** 两侧一致：都激活同一 taskType，或都不激活。 */
    | 'agree'
    /** 影子（模型声明）会激活，但真实（关键词门 OR 足迹）当前未激活——关键词漏判 + 早窗口样本。 */
    | 'earlier_activation'
    /** 两侧都激活但 taskType 不同——关键词判 X、模型声明 Y。 */
    | 'task_type_mismatch'
    /** 真实已激活，但影子无模型声明（模型没声明，靠关键词/足迹激活）——信息项，非漏判。 */
    | 'shadow_missing_declaration';

export interface IntentActivationSnapshot {
    /** 是否激活设计纪律。 */
    active: boolean;
    /** 激活时的任务类型 id（可缺省）。 */
    taskTypeId?: string;
    /** 判据来源（真实侧固定 'keyword_or_footprint'；影子侧为 DesignIntentSignalSource）。 */
    source?: string;
}

export interface IntentShadowDivergenceRecord {
    divergenceKind: IntentShadowDivergenceKind;
    real: IntentActivationSnapshot;
    shadow: IntentActivationSnapshot;
}

/**
 * 确定性判定一次工具调用后"真实激活 vs 影子（模型声明作主判据）"的分歧类别。纯函数、无副作用。
 * 调用方把返回记录累积成诊断日志（不据此改变任何激活行为）。
 */
export function recordIntentShadowDivergence(
    real: IntentActivationSnapshot,
    shadow: IntentActivationSnapshot
): IntentShadowDivergenceRecord {
    let divergenceKind: IntentShadowDivergenceKind;
    if (shadow.active && !real.active) {
        divergenceKind = 'earlier_activation';
    } else if (
        real.active && shadow.active
        && real.taskTypeId && shadow.taskTypeId
        && real.taskTypeId !== shadow.taskTypeId
    ) {
        divergenceKind = 'task_type_mismatch';
    } else if (real.active && !shadow.active) {
        divergenceKind = 'shadow_missing_declaration';
    } else {
        divergenceKind = 'agree';
    }
    return { divergenceKind, real, shadow };
}

/** 是否为需要关注的真实分歧（earlier_activation / task_type_mismatch）——供诊断统计筛选。 */
export function isNotableIntentDivergence(record: IntentShadowDivergenceRecord): boolean {
    return record.divergenceKind === 'earlier_activation'
        || record.divergenceKind === 'task_type_mismatch';
}

// ── public-plan 路由影子对比（V2「让模型先推理再决定是否走 public-plan」P1）──
//
// 当前"走不走 public-plan"由执行授权决定：confirmed_tool_required 可直接进入 Agent runtime，
// candidate_only 仍需公开计划/确认。这里在不改变真实路由的前提下，把模型建议与授权路径实时
// 影子对比，记录模型是否建议更早执行或更早请求确认。

export type PublicPlanRoutingApproach = 'direct_loop' | 'public_plan';

export type PublicPlanRoutingDivergenceKind =
    /** 模型建议与授权路径一致。 */
    | 'agree'
    /** 模型建议直接进循环，但当前只有 candidate_only 授权。 */
    | 'model_skips_plan'
    /** 模型建议先公开计划，但当前已有 confirmed_tool_required 授权。 */
    | 'model_wants_plan'
    /** 模型没有给出路径建议，不参与分歧统计。 */
    | 'model_no_opinion';

export interface PublicPlanRoutingDivergenceRecord {
    divergenceKind: PublicPlanRoutingDivergenceKind;
    /** 执行授权当前实际允许的路径。 */
    authorizationApproach: PublicPlanRoutingApproach;
    /** 模型判定的路径（缺省=没判）。 */
    modelApproach?: PublicPlanRoutingApproach;
}

/**
 * 确定性判定"执行授权路径 vs 模型建议"的 public-plan 路由分歧。纯函数、无副作用、不改变真实路由。
 * authorizationApproach 由调用方从 executionAuthorization 派生；modelApproach 来自
 * classifyActionableIntent.executionApproach。
 */
export function recordPublicPlanRoutingDivergence(
    authorizationApproach: PublicPlanRoutingApproach,
    modelApproach?: PublicPlanRoutingApproach
): PublicPlanRoutingDivergenceRecord {
    let divergenceKind: PublicPlanRoutingDivergenceKind;
    if (modelApproach !== 'direct_loop' && modelApproach !== 'public_plan') {
        divergenceKind = 'model_no_opinion';
    } else if (modelApproach === authorizationApproach) {
        divergenceKind = 'agree';
    } else if (modelApproach === 'direct_loop') {
        divergenceKind = 'model_skips_plan';
    } else {
        divergenceKind = 'model_wants_plan';
    }
    return { divergenceKind, authorizationApproach, modelApproach };
}

/** 汇总 public-plan 路由分歧日志为计数报表（供 P3 翻转阈值对齐时读）。 */
export function summarizePublicPlanRoutingLog(
    records: PublicPlanRoutingDivergenceRecord[]
): Record<PublicPlanRoutingDivergenceKind, number> {
    const summary: Record<PublicPlanRoutingDivergenceKind, number> = {
        agree: 0,
        model_skips_plan: 0,
        model_wants_plan: 0,
        model_no_opinion: 0
    };
    for (const r of Array.isArray(records) ? records : []) {
        if (r && summary[r.divergenceKind] !== undefined) summary[r.divergenceKind] += 1;
    }
    return summary;
}

/** 汇总分歧日志为计数报表（供 P3 翻转阈值对齐时读）。 */
export function summarizeIntentShadowLog(
    records: IntentShadowDivergenceRecord[]
): Record<IntentShadowDivergenceKind, number> {
    const summary: Record<IntentShadowDivergenceKind, number> = {
        agree: 0,
        earlier_activation: 0,
        task_type_mismatch: 0,
        shadow_missing_declaration: 0
    };
    for (const r of Array.isArray(records) ? records : []) {
        if (r && summary[r.divergenceKind] !== undefined) summary[r.divergenceKind] += 1;
    }
    return summary;
}
