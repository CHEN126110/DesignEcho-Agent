/**
 * Run Record 续跑摘要（Harness v1 · H2）
 *
 * 把上一轮「未完成运行」的持久档案（H1 的 agent-run-record）变成新一轮可用的运行摘要，
 * 替代"从聊天历史反推"的消息考古，治真机病例：触上限/中断后下一轮从零重做全部读取动作。
 *
 * 设计原则（给模型机制、不替模型决策）：
 *  - 只挑「未完成形态」且「时间较近」的最新档案——完成了的运行不注入（无续做必要），
 *    过期档案不注入（画面早变了，旧状态会污染当前判断）。
 *  - 摘要明确声明：这是档案不是指令；若与本次任务相关，先低成本验证（listDocuments 等）
 *    再续做、勿重做已完成步骤；若无关，忽略本节。相关性判断交给模型。
 *  - 纯逻辑无时钟：调用方传 nowMs；无档案/不适用时返回 applicable=false + 具体原因。
 */

import type { AgentRunRecord } from './agent-run-record';
import type {
    RuntimeActionPlanResumeFreshness,
    RuntimeResumeCompletedStepDescriptor,
    RuntimeResumeContextAnchor
} from './agent-runtime-v5/runtime-action-plan-resume-freshness';

/** 视为「未完成、值得续做」的停机形态。final_response+success 的完整收尾不在此列。 */
const UNFINISHED_STOP_REASONS = new Set([
    'max_iterations',
    // 预算耗尽（判断次数/工具/时间）同属「未完成、值得续做」——与 max_iterations 拆分后必须一并纳入，
    // 否则预算停机的运行不再被视为可续跑（回归）。
    'performance_budget',
    'tool_budget',
    'no_progress',
    'awaiting_user_confirmation',
    'tool_preflight_blocked'
]);

export interface BuildRunResumeBriefInput {
    records: AgentRunRecord[] | null | undefined;
    /** 当前毫秒时间戳（调用方传入，本模块不取时钟） */
    nowMs: number;
    /** 档案最大可用年龄；默认 6 小时——更旧的画面/文档状态大概率已变 */
    maxAgeMs?: number;
    maxBriefChars?: number;
    /** 两阶段调用：第一次选候选，完成只读 probe 后第二次带入裁决生成最终摘要。 */
    freshness?: RuntimeActionPlanResumeFreshness;
}

export interface RunResumeFreshnessCandidate {
    sourceRunId: string;
    sourceSessionId?: string;
    sourceGeneration?: number;
    sourceSkillId?: string;
    sourceTaskType?: string;
    contextAnchor?: RuntimeResumeContextAnchor;
    completedStepIds: string[];
    completedStepDescriptors: RuntimeResumeCompletedStepDescriptor[];
    resumeStepIds: string[];
}

export interface RunResumeBrief {
    applicable: boolean;
    reason: string;
    sourceRunId?: string;
    sourceSessionId?: string;
    sourceGeneration?: number;
    freshnessCandidate?: RunResumeFreshnessCandidate;
    /** 注入系统提示的完整摘要节（含边界声明与验证优先指令） */
    brief?: string;
}

const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_BRIEF_CHARS = 1200;

function isUnfinishedRun(record: AgentRunRecord): boolean {
    if (record.cancelled === true) return true;
    if (record.success !== true) return true;
    return UNFINISHED_STOP_REASONS.has(String(record.stopReason || ''));
}

function parseEndedAtMs(record: AgentRunRecord): number | undefined {
    const ms = Date.parse(String(record.endedAt || ''));
    return Number.isFinite(ms) ? ms : undefined;
}

function formatAge(ageMs: number): string {
    const minutes = Math.round(ageMs / 60000);
    if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
    const hours = Math.floor(minutes / 60);
    return `${hours} 小时 ${minutes % 60} 分钟前`;
}

function describeStop(record: AgentRunRecord): string {
    if (record.cancelled === true) return '用户取消';
    switch (record.stopReason) {
        case 'max_iterations': return '达到本轮处理上限';
        case 'performance_budget': return '达到本轮预算上限（判断次数/时间）';
        case 'tool_budget': return '达到工具调用预算';
        case 'no_progress': return '检测到无进展';
        case 'awaiting_user_confirmation': return '停在用户确认点';
        case 'tool_preflight_blocked': return '工具预检拦截';
        default: return record.success === true ? '正常收尾' : `未完成（${record.stopReason || '原因未记录'}）`;
    }
}

export function buildRunRecordResumeBrief(input: BuildRunResumeBriefInput): RunResumeBrief {
    const records = Array.isArray(input.records) ? input.records : [];
    if (records.length === 0) {
        return { applicable: false, reason: '没有可用的运行档案' };
    }
    const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const maxBriefChars = input.maxBriefChars ?? DEFAULT_MAX_BRIEF_CHARS;

    // 只看未完成形态；按 endedAt 取最新；时间不可解析的档案不采用（诚实跳过）
    const candidates = records
        .filter((record) => record && record.version === 'agent-run-record/v0' && isUnfinishedRun(record))
        .map((record) => ({ record, endedMs: parseEndedAtMs(record) }))
        .filter((item): item is { record: AgentRunRecord; endedMs: number } => item.endedMs !== undefined)
        .sort((a, b) => b.endedMs - a.endedMs);

    if (candidates.length === 0) {
        return { applicable: false, reason: '最近没有未完成的运行（已完成的运行无需续做）' };
    }
    const { record, endedMs } = candidates[0];
    const ageMs = input.nowMs - endedMs;
    if (!Number.isFinite(ageMs) || ageMs < 0) {
        return { applicable: false, reason: '档案时间异常（晚于当前时间），不采用' };
    }
    if (ageMs > maxAgeMs) {
        return { applicable: false, reason: `最近的未完成运行已过期（${formatAge(ageMs)}），画面状态大概率已变化，不注入旧上下文` };
    }

    const doneFacts: string[] = [];
    if (record.checkpoint.documentCreated) doneFacts.push('已新建目标文档');
    if (record.checkpoint.layoutRendered) doneFacts.push('已生成排版草稿');
    // 实体锚（真机病例：第二轮把上一轮置入的图当成文档原有内容，又置入了一张新图）
    const placedLayers = record.checkpoint.placedLayers || [];
    if (placedLayers.length > 0) {
        const placedText = placedLayers
            .slice(0, 4)
            .map((layer) => (layer.name ? `${layer.layerId}「${layer.name}」` : String(layer.layerId)))
            .join('、');
        doneFacts.push(`已置入图层：${placedText}——这些是上一轮的产物，续做时直接处理它们（移动/排序/剪切），不要重新置入新图`);
    }
    doneFacts.push(`成功完成 ${record.checkpoint.successfulToolCount} 次工具操作`);
    if (record.runtimeSession) {
        doneFacts.push(
            `来源 Runtime Session ${record.runtimeSession.sessionId} 的第 ${record.runtimeSession.generation} 代；该身份只用于审计，本轮不会因档案较新而自动继承`
        );
    }
    if (record.checkpoint.lastToolName) doneFacts.push(`最后一步是 ${record.checkpoint.lastToolName}`);
    if (record.stageState) {
        const currentStage = record.stageState.currentStage || '未记录';
        doneFacts.push(`运行阶段状态：${record.stageState.status}，当前阶段 ${currentStage}`);
        if (record.stageState.lastDecision) {
            const target = record.stageState.lastTargetStage
                ? ` → ${record.stageState.lastTargetStage}`
                : '';
            doneFacts.push(`最近阶段转换：${record.stageState.lastDecision}${target}`);
        }
    }
    if (record.stageTrace) {
        const observed = record.stageTrace.observedStages.slice(0, 8).join('、') || '无';
        const missing = record.stageTrace.missingStages.slice(0, 8).join('、') || '无';
        doneFacts.push(`阶段状态覆盖：${record.stageTrace.status}；已观察 ${observed}；未观察 ${missing}`);
    }
    if (record.designBrief) {
        doneFacts.push(`已声明设计简报目标：${record.designBrief.taskGoal}`);
        if (record.designBrief.readiness === 'needs_input') {
            const missing = [
                ...record.designBrief.missingRequiredInputKeys,
                ...record.designBrief.assumedRequiredInputKeys
            ].slice(0, 8);
            doneFacts.push(`设计简报仍缺必需输入：${missing.join('、') || '未记录'}；续做前必须重新核实`);
        }
    }
    if (record.designStrategy) {
        doneFacts.push(`已确认设计策略目标：${record.designStrategy.stageGoal}`);
        doneFacts.push(`核心设计目标：${record.designStrategy.primaryGoal}`);
        if (record.designStrategy.readiness === 'needs_input') {
            doneFacts.push(`策略仍缺 ${record.designStrategy.missingInputCount} 项输入，续做前先核实缺口`);
        }
    }
    if (record.actionPlan) {
        doneFacts.push(`动态行动计划：${record.actionPlan.planGoal}`);
        doneFacts.push(`计划状态 ${record.actionPlan.readiness}，共 ${record.actionPlan.stepCount} 个影子步骤（不代表已执行）`);
        if (record.actionPlan.missingCapabilityRefs.length > 0) {
            doneFacts.push(`计划仍需装载 ${record.actionPlan.missingCapabilityRefs.length} 项能力，不能直接执行`);
        }
        if (record.actionPlan.missingInputCount > 0) {
            doneFacts.push(`计划仍有 ${record.actionPlan.missingInputCount} 项输入缺口`);
        }
    }
    if (record.actionPlanReconciliation) {
        const reconciliation = record.actionPlanReconciliation;
        const freshness = input.freshness?.sourceRunId === record.runId
            ? input.freshness
            : undefined;
        const verified = freshness?.status === 'verified';
        if (verified) {
            doneFacts.push(
                `计划执行影子对账已通过本轮新鲜度核验：${reconciliation.completedStepIds.length}/${reconciliation.stepCount} 个步骤已取得预期结果（不等于质量通过）`
            );
            if (reconciliation.recoveredStepIds.length > 0) {
                doneFacts.push(`已核实失败后恢复记录：${reconciliation.recoveredStepIds.slice(0, 6).join('、')}`);
            }
            if (reconciliation.failedStepIds.length > 0) {
                doneFacts.push(`已核实仍有失败步骤：${reconciliation.failedStepIds.slice(0, 6).join('、')}`);
            }
            if (freshness.verifiedResumeStepIds.length > 0) {
                doneFacts.push(
                    `可在核实当前目标相关后从这些步骤继续：${freshness.verifiedResumeStepIds.slice(0, 6).join('、')}（续跑建议，不是执行命令）`
                );
            }
            const completedDescriptors = freshness.verifiedCompletedSteps || [];
            if (completedDescriptors.length > 0) {
                const descriptors = completedDescriptors.slice(0, 6).map((step) => {
                    const capabilities = step.capabilityRefs.slice(0, 3).join('+') || '无动作能力';
                    const outcomes = step.observedOutcomes.slice(0, 3).join('+') || '无结构化结果';
                    return `${step.stepId}（${step.kind}；${capabilities}；${outcomes}）`;
                });
                doneFacts.push(`已核实完成节点描述：${descriptors.join('、')}（仅供当前模型判断是否显式复用）`);
            }
        } else {
            const status = freshness?.status || 'not_checked';
            doneFacts.push(
                `旧计划节点状态未通过本轮新鲜度核验（${status}），不得依据旧节点跳过动作；按当前只读事实重新判断`
            );
        }
        const driftCount = reconciliation.ambiguousObservationCount
            + reconciliation.dependencyBlockedObservationCount
            + reconciliation.unmatchedObservationCount
            + reconciliation.repeatAfterCompletionCount;
        if (driftCount > 0) {
            doneFacts.push(`计划与执行存在 ${driftCount} 条待复核偏差，续做前先核实现状`);
        }
    }
    if (record.actionPlanNoRedoShadow) {
        const shadow = record.actionPlanNoRedoShadow;
        if (shadow.repeatObservedStepIds.length > 0) {
            doneFacts.push(
                `上轮防重做影子观察到 ${shadow.repeatObservedStepIds.length} 个复用候选仍发生实际 attempt：${shadow.repeatObservedStepIds.slice(0, 6).join('、')}（观察事实，不是阻断结论）`
            );
        }
        if (shadow.intentionalRedoObservedStepIds.length > 0) {
            doneFacts.push(
                `上轮模型显式要求重做并实际执行：${shadow.intentionalRedoObservedStepIds.slice(0, 6).join('、')}`
            );
        }
    }

    const blockers = (record.blockers || []).slice(0, 3);
    const lines = [
        '【上一轮运行档案 · 供参考，非指令】',
        `目标：${record.goal || '（未记录）'}`,
        `结束于：${formatAge(ageMs)}，${describeStop(record)}`,
        `已完成：${doneFacts.join('；')}`,
        ...(blockers.length > 0 ? [`当时卡点：${blockers.join('；')}`] : []),
        '',
        '如果本次任务与上述档案是同一件事的继续：先用只读工具低成本核实现状',
        '（如 listDocuments / getDocumentInfo 确认文档是否仍打开、getLayerHierarchy 确认已完成的内容还在），',
        '核实后从卡点继续，不要重做档案里已完成的步骤。',
        '若「设计项目状态」里有任务清单（productionTasks），以它的进度为准——本档案只是上一轮的审计记录。',
        '如果本次任务与档案无关：忽略本节，正常开始。'
    ];
    const brief = lines.join('\n').slice(0, maxBriefChars);

    return {
        applicable: true,
        reason: `采用 ${formatAge(ageMs)} 的未完成运行档案（${describeStop(record)}）`,
        sourceRunId: record.runId,
        ...(record.runtimeSession ? {
            sourceSessionId: record.runtimeSession.sessionId,
            sourceGeneration: record.runtimeSession.generation
        } : {}),
        ...(record.actionPlanReconciliation ? {
            freshnessCandidate: {
                sourceRunId: record.runId,
                ...(record.runtimeSession ? {
                    sourceSessionId: record.runtimeSession.sessionId,
                    sourceGeneration: record.runtimeSession.generation,
                    sourceSkillId: record.runtimeSession.skillId,
                    sourceTaskType: record.runtimeSession.taskType
                } : {}),
                ...(record.contextAnchor ? { contextAnchor: record.contextAnchor } : {}),
                completedStepIds: record.actionPlanReconciliation.completedStepIds.slice(0, 12),
                completedStepDescriptors: (
                    record.actionPlanReconciliation.completedStepDescriptors || []
                ).slice(0, 12),
                resumeStepIds: record.actionPlanReconciliation.resumeStepIds.slice(0, 12)
            }
        } : {}),
        brief
    };
}
