/**
 * 设计意图信号（单一判定源，纯逻辑，可 smoke）。
 *
 * 北极星（用户原则）：Agent 是聪明大脑，不能用硬编码意图正则把它关进井底；不靠关键词预判用户意图。
 *
 * 现状问题（本会话实测）：设计纪律 / 质量裁决 / 记忆注入 全部挂在 isCreativeDesignIntent 之后，而它由
 * agent-intent-control-plane 的 EXPLICIT_CREATIVE_DESIGN_PATTERNS 关键词正则门控——动词与名词间只允许
 * `\s*`+量词，夹一个形容词（"设计一张【促销】主图"的"促销"）就漏判，整套纪律静默失活。这是"井盖"。
 *
 * 本模块用**不依赖用户措辞关键词**的信号回答"模型是不是在做设计"：
 *   1) 行为足迹（最可靠、不可伪造）：模型真的 createDocument 成功 + 放了视觉元素（图/形状），
 *      就是在做设计——无论用户当初怎么措辞。文案可有可无（纯图海报/封面也算，partial）。
 *   2) 模型声明（次之）：模型在循环里结构化声明 task_type（poster/main-image/...），是它自己的理解，
 *      不是我们用正则猜——用于"还没动手就先激活"的早期窗口。
 *   3) 结构信号（兜底）：skillId / intentMode 等已结构化的上下文。
 * **刻意不含任何"对用户文本做关键词匹配"的判据**——让"模型主导"，把关键词留给影子比对去证明是否还需要。
 *
 * 设计目标：作为 design-discipline.active / task-completion creative_design / scenario / 品类解析
 * 四套重叠分类器未来收敛的**单一口径**，消除 control-plane(\s*+量词) 与 inferTaskKind(.{0,5}) 的宽严漂移。
 *
 * 现状（Step1）：本文件**纯新增、未接线、不删任何旧正则**。行为足迹工具集与判定逻辑暂在此自带一份
 * （与 task-completion-contract.ts 的 hasDesignToolFootprint 等价），Step2 收敛时再统一为单一来源。
 */

export type DesignIntentSignalSource = 'tool_footprint' | 'model_declaration' | 'skill_id' | 'none';

export interface DesignIntentSignal {
    version: 'design-intent-signal/v0';
    /** 模型当前是否在做（或已声明要做）设计。 */
    isDesign: boolean;
    /** 模型显式声明的任务类型 id（仅来自结构化声明，非关键词推断）；未声明则 undefined → 走 GENERIC 兜底。 */
    taskTypeId?: string;
    /** isDesign=true 时的判据来源，便于诊断与影子比对。 */
    source: DesignIntentSignalSource;
    /** 设计进行中但尚不完整（已建画布+视觉、还没文案）——覆盖"纯图/少文案"品类，不因 copyCount=0 误判非设计。 */
    partial: boolean;
    /** 行为足迹明细（诊断用）。 */
    footprint: {
        hasCreateDocument: boolean;
        subjectCount: number;
        shapeCount: number;
        copyCount: number;
    };
}

export interface DesignIntentSignalInput {
    /** 本轮工具调用日志（最小结构 {name,result}，避免反向依赖 renderer 类型）。 */
    toolCallLog?: Array<{ name?: string; result?: any }> | null;
    /**
     * 模型结构化声明的任务类型 id（须为 DESIGN_TASK_TYPE_REGISTRY 已注册 id，如 'ecommerce.detail_page.v1'
     * / 'ecommerce.main_image.v1' / 'ecommerce.sku_template.v1'）。未注册品类（如"海报"）当前不在注册表内，
     * 需先进注册表才谈得上被有效声明——声明通道 ≠ 品类覆盖面，二者不可混淆。
     */
    declaredTaskType?: string | null;
    /** 已路由的技能 id（结构信号，非用户关键词）。 */
    skillId?: string | null;
    /** 意图模式（结构信号）。 */
    intentMode?: string | null;
    /**
     * 可选的声明 id 合法性校验器（纵深防御）：提供时，declaredTaskType 只有通过校验（已注册品类）才被
     * 采信为 model_declaration；未提供则保持原行为（向后兼容）。由调用方注入 design-task-types 的
     * isRegisteredDesignTaskTypeId，避免本纯逻辑模块反向依赖注册表形成模块环。防"声明脏 id → isDesign=true
     * 但 spec=undefined 的半激活态"。
     */
    isValidTaskTypeId?: (id: string) => boolean;
}

// 行为足迹工具集（与 task-completion-contract.ts:114-133 等价；Step2 收敛为单一来源）。
const SUBJECT_IMAGE_TOOLS = new Set(['placeImage', 'replaceLayerContent', 'applyRasterImageResult']);
const SHAPE_TOOLS = new Set(['renderLayout', 'createRectangle', 'createEllipse', 'createShape', 'setLayerFill', 'addGradientOverlay']);
const COPY_TOOLS = new Set(['renderLayout', 'createTextLayer', 'setTextContent']);

// 已结构化为"设计场景"的技能 id（结构信号，非对用户措辞做关键词匹配）。
const DESIGN_SKILL_IDS = new Set([
    'main-image-design',
    'detail-page-design',
    'sku-config',
    'design-reference-search',
    'autonomous-agent'
]);

function toolSucceeded(entry: { result?: any }): boolean {
    return entry?.result?.success !== false;
}

function countSuccessful(log: Array<{ name?: string; result?: any }>, names: Set<string>): number {
    let count = 0;
    for (const entry of log) {
        if (entry && entry.name && names.has(entry.name) && toolSucceeded(entry)) count += 1;
    }
    return count;
}

/**
 * 计算行为足迹。complete=建画布+视觉+文案；partial=建画布+视觉但无文案（纯图设计进行中）。
 * createDocument 单独存在（无任何视觉元素）不算设计——可能是建文档做工具验证，不预判。
 */
export function evaluateDesignToolFootprint(toolCallLog?: Array<{ name?: string; result?: any }> | null): {
    hasCreateDocument: boolean;
    subjectCount: number;
    shapeCount: number;
    copyCount: number;
    hasVisual: boolean;
    complete: boolean;
    partial: boolean;
} {
    const log = Array.isArray(toolCallLog) ? toolCallLog : [];
    const hasCreateDocument = log.some((e) => e && e.name === 'createDocument' && toolSucceeded(e));
    const subjectCount = countSuccessful(log, SUBJECT_IMAGE_TOOLS);
    const shapeCount = countSuccessful(log, SHAPE_TOOLS);
    const copyCount = countSuccessful(log, COPY_TOOLS);
    const hasVisual = subjectCount > 0 || shapeCount > 0;
    const complete = hasCreateDocument && hasVisual && copyCount > 0;
    const partial = hasCreateDocument && hasVisual && copyCount === 0;
    return { hasCreateDocument, subjectCount, shapeCount, copyCount, hasVisual, complete, partial };
}

/**
 * 单一设计意图判定。优先级：行为足迹(complete) > 模型声明 > 行为足迹(partial) > 设计技能 id > 无。
 * 全程不对用户文本做关键词匹配。
 */
export function resolveDesignIntentSignal(input: DesignIntentSignalInput = {}): DesignIntentSignal {
    const footprint = evaluateDesignToolFootprint(input.toolCallLog);
    const declaredRaw = typeof input.declaredTaskType === 'string' && input.declaredTaskType.trim()
        ? input.declaredTaskType.trim()
        : undefined;
    // 纵深防御：提供校验器时，只采信已注册的合法 taskTypeId（拼错/幻觉的 id 安全降级为"未声明"，
    // 不进 model_declaration 分支，杜绝 isDesign=true 但 spec=undefined 的半激活态）。未提供校验器时
    // 保持原行为（向后兼容）。
    const declared = declaredRaw && input.isValidTaskTypeId && !input.isValidTaskTypeId(declaredRaw)
        ? undefined
        : declaredRaw;
    const isDesignSkill = typeof input.skillId === 'string' && DESIGN_SKILL_IDS.has(input.skillId)
        && input.skillId !== 'autonomous-agent'; // autonomous-agent 是通用入口，不单独作为设计信号

    const base = {
        version: 'design-intent-signal/v0' as const,
        footprint: {
            hasCreateDocument: footprint.hasCreateDocument,
            subjectCount: footprint.subjectCount,
            shapeCount: footprint.shapeCount,
            copyCount: footprint.copyCount
        }
    };

    if (footprint.complete) {
        return { ...base, isDesign: true, source: 'tool_footprint', partial: false, taskTypeId: declared };
    }
    if (declared) {
        return { ...base, isDesign: true, source: 'model_declaration', partial: footprint.partial, taskTypeId: declared };
    }
    if (footprint.partial) {
        return { ...base, isDesign: true, source: 'tool_footprint', partial: true };
    }
    if (isDesignSkill) {
        return { ...base, isDesign: true, source: 'skill_id', partial: false, taskTypeId: declared };
    }
    return { ...base, isDesign: false, source: 'none', partial: false };
}
