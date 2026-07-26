/**
 * 视觉观察卡片动作的确定性控制器（按 GPT 纠偏：删除 handleSend 重入）。
 *
 * 卡片动作（点"查看通用结构草案"等）**不再经 ChatPanel 发送管线重发消息**（那会重复插入用户
 * 消息、重进 Thinking、双击重复生成卡片、甚至误入普通聊天/旧 engine）。改为直接进入本控制器：
 * 校验动作可用性 → 读 Skill preset → buildStructureOnlyPlan → Claim Guard → 生成 skeleton 卡片。
 *
 * 纯逻辑、确定性、幂等：同一来源卡片 + 同一 actionId 永远得到相同结果，不产生任何副作用
 * （不写状态、不调模型、不触发 UI、不发请求）。副作用由 ChatPanel 据返回的 result.type 决定。
 */

import {
    getStructureSkillPreset,
    buildStructureOnlyPlan,
    assertStructureOnlyPlanClean
} from './structure-only-plan';
import {
    buildStructureOnlySkeletonCard,
    type VisualObservationBlockedCard,
    type StructureOnlySkeletonCard
} from './visual-observation-card';

/** 控制器结果：渲染骨架卡片 / 拒绝（过期、不支持、能力未就绪、未知）。 */
export type VisualObservationCardActionResult =
    | { type: 'card'; card: StructureOnlySkeletonCard }
    | { type: 'rejected'; code: string; message: string };

function rejected(code: string, message: string): VisualObservationCardActionResult {
    return { type: 'rejected', code, message };
}

/**
 * 提交一个 blocked 卡片上的动作。校验顺序：
 * 1. 动作必须存在于该卡片（防伪造）
 * 2. 动作必须 enabled（disabled 手工提交一律 rejected，防手工跳过 UI）
 * 3. VIEW_STRUCTURE_SKELETON → 确定性骨架卡片（preset 缺失 fail-closed）
 * 4. SELECT_PRODUCT_IMAGES / RUN_PROJECT_VISUAL_ANALYSIS → 能力未就绪，rejected
 */
export function submitVisualObservationCardAction(
    card: VisualObservationBlockedCard,
    actionId: string
): VisualObservationCardActionResult {
    if (!card || !Array.isArray(card.actions)) {
        return rejected('INVALID_CARD', '卡片数据缺失或无效。');
    }
    const action = card.actions.find((item) => item.actionId === actionId);
    if (!action) {
        return rejected('UNSUPPORTED_ACTION', '当前卡片不支持该操作。');
    }
    if (action.state !== 'enabled') {
        return rejected('ACTION_DISABLED', action.disabledReason?.message || '该能力当前不可用。');
    }

    const context = card.context;
    if (actionId === 'VIEW_STRUCTURE_SKELETON') {
        const preset = getStructureSkillPreset(context.taskType);
        if (!preset) {
            return rejected('NO_STRUCTURE_PRESET', '当前任务类型没有可用的结构草案配置。');
        }
        const plan = buildStructureOnlyPlan({
            preset,
            projectId: context.projectId,
            sourceRevision: context.sourceRevision
        });
        //  fail-closed：骨架若混入产品事实或偏离 preset，抛错，绝不发布
        assertStructureOnlyPlanClean(plan, preset);
        return { type: 'card', card: buildStructureOnlySkeletonCard({ plan, context }) };
    }
    if (actionId === 'SELECT_PRODUCT_IMAGES') {
        return rejected('SELECT_IMAGES_NOT_READY', '选择代表图片功能正在接入，当前可先点"查看通用结构草案"。');
    }
    if (actionId === 'RUN_PROJECT_VISUAL_ANALYSIS') {
        return rejected('VISUAL_BOOTSTRAP_NOT_READY', '图片分析服务正在接入，敬请期待。');
    }
    return rejected('UNKNOWN_ACTION', '当前卡片不支持该操作。');
}
