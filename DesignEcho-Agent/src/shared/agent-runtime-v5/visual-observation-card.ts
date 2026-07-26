/**
 * 视觉观察 / 结构草案的展示卡片契约（按 GPT 混合方案）。
 *
 * 契约分层：
 * - 领域契约：VisualObservationBlocker（gate）/ StructureOnlyPlan（structure-only-plan）——权威数据。
 * - 展示契约（本文件）：由领域契约**单向映射**得到的只读展示视图。
 * - 通用外壳：InteractiveCardDefinition（interactive-card-contract）——通用 UI 运输与提交机制。
 *
 * 硬约束（按 GPT 决策）：
 * - 复用 InteractiveCardDefinition 外壳与 submitAction 提交机制，但为两类卡片建独立强类型、可判别契约；
 *   kind 命名空间化（visual-observation.blocked / structure-only.skeleton），不复用泛化的 confirm/edit/blocked。
 * - **禁止卡片反向成为 ContextSnapshot / Project State / Artifact 的数据源**：卡片只展示，不回写权威数据。
 *
 * 纯逻辑：只做契约定义与领域→展示的映射，不触发 UI、不写状态。
 */

import type { InteractiveCardDefinition } from '../interactive-card-contract';
import type { VisualObservationBlocker } from './visual-observation-gate';
import type { StructureOnlyPlan } from './structure-only-plan';

/** 卡片提交统一窄入口（复用现有 submitInteractiveCard 分发）。 */
export const VISUAL_OBSERVATION_CARD_SUBMIT_ACTION = 'submitVisualObservationCard';

/** 命名空间化的卡片 kind（避免与现有 confirm/edit 卡片冲突）。 */
export type VisualObservationCardKind = 'visual-observation.blocked' | 'structure-only.skeleton';

/** 卡片动作 id（对应三恢复动作）。 */
export type VisualObservationCardActionId =
    | 'RUN_PROJECT_VISUAL_ANALYSIS'
    | 'SELECT_PRODUCT_IMAGES'
    | 'VIEW_STRUCTURE_SKELETON';

/** 一个卡片动作（按钮）。state=disabled 时必须给 disabledReason。 */
export interface VisualObservationCardAction {
    actionId: VisualObservationCardActionId;
    label: string;
    state: 'enabled' | 'disabled';
    disabledReason?: { code: string; message: string };
}

/** 卡片上下文（机器标识，便于回链；不承载产品事实）。 */
export interface VisualObservationCardContext {
    projectId: string;
    conversationId: string;
    taskType: string;
    sourceRevision: number;
}

/** blocked 卡片 payload：只放阻断器（领域契约的只读副本）。 */
export interface VisualObservationBlockedCardPayload {
    blocker: VisualObservationBlocker;
}

/** 结构草案卡片中一个模块的展示视图（从 StructureOnlyPlan 单向映射，不含产品事实文案）。 */
export interface StructureOnlySkeletonModuleView {
    moduleId: string;
    moduleType: string;
    order: number;
    intentText: string;
    placeholders: string[];
    requiredInputSlots: string[];
}

/** 结构草案卡片 payload：骨架的只读展示视图。 */
export interface StructureOnlySkeletonCardPayload {
    planId: string;
    presetId: string;
    capabilityStatus: 'fallback';
    outputScope: 'structure_only';
    modules: StructureOnlySkeletonModuleView[];
}

/** 视觉观察卡片：复用 InteractiveCardDefinition 外壳 + 强类型 kind/context/actions。 */
export interface VisualObservationCard<TKind extends VisualObservationCardKind, TPayload>
    extends InteractiveCardDefinition<TPayload> {
    kind: TKind;
    context: VisualObservationCardContext;
    actions: VisualObservationCardAction[];
}

export type VisualObservationBlockedCard = VisualObservationCard<'visual-observation.blocked', VisualObservationBlockedCardPayload>;
export type StructureOnlySkeletonCard = VisualObservationCard<'structure-only.skeleton', StructureOnlySkeletonCardPayload>;

/**
 * 构造"视觉观察不足"阻断卡片（三恢复动作）。
 * "分析项目图片"按钮的可用性由 visualBootstrapReady 决定——P0 Main 视觉服务未就绪时禁用并给理由。
 */
export function buildVisualObservationBlockedCard(input: {
    blocker: VisualObservationBlocker;
    context: VisualObservationCardContext;
    visualBootstrapReady: boolean;
}): VisualObservationBlockedCard {
    const analyzeDisabled = !input.visualBootstrapReady;
    return {
        version: 'interactive-card/v0',
        id: `visual-observation-blocked:${input.context.projectId}:${input.context.sourceRevision}`,
        kind: 'visual-observation.blocked',
        title: '需要先看过产品图片',
        description: input.blocker.message,
        context: input.context,
        payload: { blocker: input.blocker },
        actions: [
            {
                actionId: 'RUN_PROJECT_VISUAL_ANALYSIS',
                label: '分析项目图片',
                state: analyzeDisabled ? 'disabled' : 'enabled',
                disabledReason: analyzeDisabled
                    ? { code: 'VISUAL_BOOTSTRAP_NOT_READY', message: '图片分析服务正在接入。当前可以选择代表图片，或先查看通用结构草案。' }
                    : undefined
            },
            { actionId: 'SELECT_PRODUCT_IMAGES', label: '选择代表图片', state: 'enabled' },
            { actionId: 'VIEW_STRUCTURE_SKELETON', label: '查看通用结构草案', state: 'enabled' }
        ],
        submitAction: VISUAL_OBSERVATION_CARD_SUBMIT_ACTION
    };
}

/**
 * 由 StructureOnlyPlan **单向映射**出结构草案展示卡片。卡片只读，不回写任何权威数据。
 * intentText 直接取自 plan（已由 Claim Guard 对照 preset 核对过，保证不含产品事实）。
 */
export function buildStructureOnlySkeletonCard(input: {
    plan: StructureOnlyPlan;
    context: VisualObservationCardContext;
}): StructureOnlySkeletonCard {
    const { plan, context } = input;
    return {
        version: 'interactive-card/v0',
        id: `structure-only-skeleton:${plan.planId}`,
        kind: 'structure-only.skeleton',
        title: '通用结构草案（不含产品事实）',
        description: '以下仅为版面结构与占位，产品文案需经真实视觉观察或你的确认后再填充。',
        context,
        payload: {
            planId: plan.planId,
            presetId: plan.presetId,
            capabilityStatus: 'fallback',
            outputScope: 'structure_only',
            modules: plan.modules.map((m) => ({
                moduleId: m.moduleId,
                moduleType: m.moduleType,
                order: m.order,
                intentText: m.intent.text,
                placeholders: [...m.placeholders],
                requiredInputSlots: [...m.requiredInputSlots]
            }))
        },
        actions: [],
        submitAction: VISUAL_OBSERVATION_CARD_SUBMIT_ACTION
    };
}
