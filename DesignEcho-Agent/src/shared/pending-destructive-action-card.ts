/**
 * 破坏性动作 HITL（V1-7b）：待确认破坏性动作的单一职责模块（设计 β）。
 *
 * 背景：tool-safety-policy 只做"确定性拦截 + 需显式确认参数"，在 7b 之前的固有边界是
 * 模型可从拦截消息里自补 confirm 参数重试——勾选框沦为装饰品、"确认的目标≠执行的目标"。
 * 本模块把该边界升级为真人类确认 + 确定性重放，收敛四件事到一处：
 *   1) 暂存：把命中拦截的那一次确切 (toolName, params) 原样存进卡片 payload.call（重放的唯一事实源）；
 *   2) 建卡：产出 destructive-action.confirmation 交互卡（两枚显式提交动作 CONFIRM_EXECUTE/CANCEL，
 *      而非可 toggle 的 boolean 字段——这正是"装饰性勾选框"的根因，本模块刻意避开）；
 *   3) 确认重放：ChatPanel 点"确认执行"后由确定性控制器从 payload.call 取暂存原始调用、只补
 *      requiredConfirmParam:true，绝不由模型从卡片文本重建调用（红线 B）；
 *   4) 拒绝续跑：点"取消"不执行任何破坏性动作。
 *
 * 两条红线的落点：
 *   (A) 真同意门：evaluateHumanConfirmationGate 先剥离模型自带的确认参数再裁决，使自主循环里
 *       模型永远无法自我确认破坏性动作——命中破坏性分支必出卡、必停机；唯一能置入确认参数的
 *       是本模块的确定性重放控制器（经 ChatPanel 直连执行路径，绕开自主安全门）。
 *   (B) 消灭错目标：重放的 params 来自 payload.call 暂存的原始对象，只叠加确认参数，不含任何模型重建。
 *
 * 纯逻辑、确定性、无副作用（不写状态、不调模型、不触发 UI、不发请求）；副作用由 ChatPanel 据返回值决定。
 * 渲染进程 / 主进程均可安全导入。
 */

import { TOOL_SAFETY_POLICY, evaluateToolSafety } from './tool-safety-policy';
import type { ToolSafetyClass, ToolSafetyVerdict } from './tool-safety-policy';
import {
    cleanInteractiveCardText,
    stableInteractiveCardHash,
    type InteractiveCardDefinition
} from './interactive-card-contract';

/** 卡片提交统一窄入口（ChatPanel 据此分发到确定性控制器；不复用 submitInteractiveCard 泛化分支）。 */
export const PENDING_DESTRUCTIVE_ACTION_SUBMIT_ACTION = 'submitDestructiveActionCard';

/** 命名空间化 kind（避免与 confirm/edit/visual-observation 卡冲突）。 */
export type PendingDestructiveActionKind = 'destructive-action.confirmation';

/** 两枚显式提交动作——刻意不用 boolean toggle（红线 A：确认必须是明确动作，不是可翻的开关）。 */
export type PendingDestructiveActionActionId = 'CONFIRM_EXECUTE' | 'CANCEL';

/** 暂存的原始调用快照——重放的唯一事实源（红线 B）。 */
export interface PendingDestructiveActionCallSnapshot {
    toolName: string;
    /** 命中拦截那一次的确切参数（已剥离模型自带确认参数；重放时才叠加确认参数）。 */
    params: Record<string, any>;
    /** 该工具的确认参数名（closeDocument→confirmDestructive、interactWithBrowserPage→confirmSensitiveAction）。 */
    requiredConfirmParam: string;
}

export interface PendingDestructiveActionCardPayload {
    version: 'destructive-action-confirmation/v0';
    /** 暂存的原始调用；重放只读它、不读卡片可视文本。 */
    call: PendingDestructiveActionCallSnapshot;
    safetyClass: ToolSafetyClass;
    /** 面向用户的风险说明（来自安全策略裁决消息）。 */
    riskReason: string;
    /** 人类可读的"对什么做什么/影响/风险"。 */
    targetSummary: string;
}

export interface PendingDestructiveActionCardAction {
    actionId: PendingDestructiveActionActionId;
    label: string;
    state: 'enabled';
    intent: 'confirm' | 'cancel';
}

export interface PendingDestructiveActionCard
    extends InteractiveCardDefinition<PendingDestructiveActionCardPayload> {
    kind: PendingDestructiveActionKind;
    actions: PendingDestructiveActionCardAction[];
}

/** 剥离一次调用里指定的确认参数（不改原对象，返回浅拷贝）。 */
function stripConfirmParam(params: any, confirmParam: string): Record<string, any> {
    const source = params && typeof params === 'object' ? params : {};
    const clone: Record<string, any> = { ...source };
    if (confirmParam in clone) delete clone[confirmParam];
    return clone;
}

/** 从工具名+参数确定性生成"对什么做什么/影响"的人类可读摘要（卡片标题下方展示）。 */
function summarizeDestructiveTarget(toolName: string, params: Record<string, any>): string {
    const p = params || {};
    if (toolName === 'closeDocument') {
        const doc = cleanInteractiveCardText(p.documentName ?? p.name);
        return doc
            ? `关闭文档「${doc}」且不保存（未保存的修改将全部丢弃）`
            : '关闭当前文档且不保存（未保存的修改将全部丢弃）';
    }
    if (toolName === 'interactWithBrowserPage') {
        const el = cleanInteractiveCardText(p.selector ?? p.elementRef ?? p.element ?? p.text);
        return el
            ? `在你的真实浏览器里点击「${el}」（可能触发支付/下单/删除/发布等不可逆动作）`
            : '在你的真实浏览器里执行点击（可能触发支付/下单/删除/发布等不可逆动作）';
    }
    return `执行 ${toolName}（不可逆操作）`;
}

/**
 * 自主循环的"人类确认门"裁决。返回 null=真正安全放行；返回 verdict+strippedParams=需真人确认。
 * 关键：先剥离模型自带的确认参数再按安全策略裁决——模型在自主循环里无法自我确认破坏性动作（红线 A）。
 * 非破坏性分支（如 closeDocument save:true）剥离后 evaluateToolSafety 仍返回 null，正常放行。
 */
export function evaluateHumanConfirmationGate(
    toolName: string,
    params: any
): { verdict: ToolSafetyVerdict; strippedParams: Record<string, any> } | null {
    const rule = TOOL_SAFETY_POLICY[toolName];
    if (!rule) return null;
    const strippedParams = stripConfirmParam(params, rule.confirmParam);
    const verdict = evaluateToolSafety(toolName, strippedParams);
    if (!verdict) return null;
    return { verdict, strippedParams };
}

/** 构造待确认破坏性动作卡（暂存传入的确切调用；两枚显式动作，无 boolean 字段）。 */
export function buildPendingDestructiveActionCard(input: {
    verdict: ToolSafetyVerdict;
    toolName: string;
    params: Record<string, any>;
}): PendingDestructiveActionCard {
    const { verdict, toolName } = input;
    const params = input.params && typeof input.params === 'object' ? { ...input.params } : {};
    const targetSummary = summarizeDestructiveTarget(toolName, params);
    const call: PendingDestructiveActionCallSnapshot = {
        toolName,
        params,
        requiredConfirmParam: verdict.requiredConfirmParam
    };
    return {
        version: 'interactive-card/v0',
        id: `destructive-action:${toolName}:${stableInteractiveCardHash({ toolName, params })}`,
        kind: 'destructive-action.confirmation',
        title: '需要你确认这个不可逆操作',
        description: targetSummary,
        status: 'draft',
        payload: {
            version: 'destructive-action-confirmation/v0',
            call,
            safetyClass: verdict.class,
            riskReason: verdict.message,
            targetSummary
        },
        actions: [
            { actionId: 'CONFIRM_EXECUTE', label: '确认执行', state: 'enabled', intent: 'confirm' },
            { actionId: 'CANCEL', label: '取消', state: 'enabled', intent: 'cancel' }
        ],
        submitAction: PENDING_DESTRUCTIVE_ACTION_SUBMIT_ACTION
    };
}

/**
 * 构造执行器 wrapper 命中拦截时的返回结果：控制信号（policyGate，不计入熔断/no_progress）+ 携带待确认卡 +
 * success:false（破坏性动作尚未执行）。面向模型的说明刻意不再指示"自补 confirm 重试"——改为"已转交用户确认、勿重复调用"。
 */
export function buildPendingDestructiveActionBlockResult(input: {
    verdict: ToolSafetyVerdict;
    card: PendingDestructiveActionCard;
}): {
    success: false;
    policyGate: true;
    safetyBlock: true;
    awaitingUserConfirmation: true;
    requiredConfirmParam: string;
    error: string;
    message: string;
    interactiveCards: PendingDestructiveActionCard[];
} {
    return {
        success: false,
        policyGate: true,
        safetyBlock: true,
        awaitingUserConfirmation: true,
        requiredConfirmParam: input.verdict.requiredConfirmParam,
        error: input.verdict.message,
        message:
            `此操作不可逆（${input.card.payload.targetSummary}），已生成确认卡片转交用户确认。` +
            `请勿重复调用该工具，也不要自行补确认参数——等待用户在卡片上确认或取消后再继续。`,
        interactiveCards: [input.card]
    };
}

/** 类型守卫：判别是否为待确认破坏性动作卡。 */
export function isPendingDestructiveActionCard(value: unknown): value is PendingDestructiveActionCard {
    const card = value && typeof value === 'object' ? value as Partial<PendingDestructiveActionCard> : {};
    const payload = card.payload as Partial<PendingDestructiveActionCardPayload> | undefined;
    const call = payload?.call;
    return card.version === 'interactive-card/v0'
        && card.kind === 'destructive-action.confirmation'
        && payload?.version === 'destructive-action-confirmation/v0'
        && !!call
        && typeof call.toolName === 'string' && call.toolName.length > 0
        && typeof call.requiredConfirmParam === 'string' && call.requiredConfirmParam.length > 0;
}

/** 确定性控制器返回类型。 */
export type PendingDestructiveActionSubmission =
    | { type: 'execute'; toolName: string; params: Record<string, any>; card: PendingDestructiveActionCard }
    | { type: 'cancelled'; card: PendingDestructiveActionCard }
    | { type: 'rejected'; code: string; message: string };

/**
 * 提交待确认破坏性动作卡上的一个动作（ChatPanel 确定性控制器，不重入模型轮）。
 * CONFIRM_EXECUTE → 从 payload.call 取暂存的原始 params、只叠加 requiredConfirmParam:true 供确定性重放（红线 B）。
 * CANCEL → cancelled（调用方据此干净续跑，不执行任何破坏性动作）。
 * 卡片无效/动作不存在 → rejected（防伪造、防手工跳过 UI）。
 */
export function resolvePendingDestructiveActionSubmission(
    card: unknown,
    actionId: string
): PendingDestructiveActionSubmission {
    if (!isPendingDestructiveActionCard(card)) {
        return { type: 'rejected', code: 'INVALID_CARD', message: '确认卡片数据缺失或无效，请重新触发操作。' };
    }
    const action = card.actions.find((item) => item.actionId === actionId);
    if (!action) {
        return { type: 'rejected', code: 'UNSUPPORTED_ACTION', message: '当前卡片不支持该操作。' };
    }
    if (actionId === 'CANCEL') {
        return { type: 'cancelled', card };
    }
    if (actionId === 'CONFIRM_EXECUTE') {
        const call = card.payload.call;
        const params = { ...call.params, [call.requiredConfirmParam]: true };
        return { type: 'execute', toolName: call.toolName, params, card };
    }
    return { type: 'rejected', code: 'UNKNOWN_ACTION', message: '当前卡片不支持该操作。' };
}
