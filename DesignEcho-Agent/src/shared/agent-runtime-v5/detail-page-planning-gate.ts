/**
 * 详情页规划门禁决策（接入核心，纯逻辑）。
 *
 * 把"视觉观察门禁 + 卡片构造 + 是否允许调规划模型"整合成一个**可 Node 测的纯函数**，
 * ChatPanel v5 分支据此决定：full → 调 PlannerModelCaller 规划；blocked / structure_only →
 * 渲染对应卡片、**不调任何规划模型**、直接收口。这样 spy 可断言"blocked/structure_only 时调用=0"。
 *
 * 边界：纯逻辑，不调模型、不写状态、不触发 UI；只产出"渲染什么卡片 / 是否放行规划"的决策。
 */

import {
    evaluateVisualObservationGate,
    buildVisualObservationRequiredBlocker,
    type VisualObservationGateInput
} from './visual-observation-gate';
import {
    buildVisualObservationBlockedCard,
    buildStructureOnlySkeletonCard,
    type VisualObservationBlockedCard,
    type StructureOnlySkeletonCard,
    type VisualObservationCardContext
} from './visual-observation-card';
import {
    buildStructureOnlyPlan,
    getStructureSkillPreset,
    assertStructureOnlyPlanClean
} from './structure-only-plan';
import {
    buildPlanningReflexionContract,
    type RuntimeReflexionContract
} from './reflexion-contract';

export interface DetailPagePlanningGateInput {
    /** 门禁观察输入（含 visualInsightCache / 元数据 / currentAssetSetHash / fallbackMode）。 */
    gate: VisualObservationGateInput;
    /** 卡片上下文（projectId / conversationId / taskType / sourceRevision）。 */
    context: VisualObservationCardContext;
    /** Main 视觉服务是否就绪（决定"分析项目图片"按钮可用性）。P0 为 false。 */
    visualBootstrapReady: boolean;
}

/** full：放行规划（调 PlannerModelCaller）。blocked/structure_only：渲染卡片、不调模型。 */
export type DetailPagePlanningDecision =
    | { planningMode: 'full' }
    | { planningMode: 'blocked'; card: VisualObservationBlockedCard; reflexion: RuntimeReflexionContract }
    | { planningMode: 'structure_only'; card: StructureOnlySkeletonCard; reflexion: RuntimeReflexionContract };

/**
 * 决策详情页规划入口。规则：
 * - 门禁 full → { full }（放行，ChatPanel 调规划模型）
 * - 门禁 structure_only → 取 Skill preset 确定性生成骨架 + Claim Guard，产出 skeleton 卡片
 *   （preset 缺失 → fail-closed 回退 blocked）
 * - 门禁 blocked → 产出三动作阻断卡片
 */
export function decideDetailPagePlanning(input: DetailPagePlanningGateInput): DetailPagePlanningDecision {
    const decision = evaluateVisualObservationGate(input.gate);

    if (decision.planningMode === 'full') {
        return { planningMode: 'full' };
    }

    if (decision.planningMode === 'structure_only') {
        const preset = getStructureSkillPreset(input.context.taskType);
        if (!preset) {
            //  fail-closed：没有该任务类型的结构 preset，不臆造骨架，退回 blocked
            const blocker = buildVisualObservationRequiredBlocker();
            return {
                planningMode: 'blocked',
                card: buildVisualObservationBlockedCard({
                    blocker,
                    context: input.context,
                    visualBootstrapReady: input.visualBootstrapReady
                }),
                reflexion: buildPlanningReflexionContract({
                    planningMode: 'blocked',
                    level: decision.level,
                    taskType: input.context.taskType,
                    blocker
                })
            };
        }
        const plan = buildStructureOnlyPlan({
            preset,
            projectId: input.context.projectId,
            sourceRevision: input.context.sourceRevision
        });
        //  fail-closed：骨架若混入产品事实或偏离 preset，抛错，绝不发布
        assertStructureOnlyPlanClean(plan, preset);
        return {
            planningMode: 'structure_only',
            card: buildStructureOnlySkeletonCard({ plan, context: input.context }),
            reflexion: buildPlanningReflexionContract({
                planningMode: 'structure_only',
                level: decision.level,
                taskType: input.context.taskType,
                constraints: decision.constraints
            })
        };
    }

    //  blocked
    const blocker = decision.blocker || buildVisualObservationRequiredBlocker();
    return {
        planningMode: 'blocked',
        card: buildVisualObservationBlockedCard({
            blocker,
            context: input.context,
            visualBootstrapReady: input.visualBootstrapReady
        }),
        reflexion: buildPlanningReflexionContract({
            planningMode: 'blocked',
            level: decision.level,
            taskType: input.context.taskType,
            blocker
        })
    };
}
