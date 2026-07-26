/**
 * SKU 无模板时的「Agent 自主设计模板」闭环契约（纯逻辑，可 smoke 验证）
 *
 * 治理背景（2026-07-02）：项目缺 SKU 模板时，此前存在两条并行分支——
 *   ① 模板方向确认卡（pending_sku_card_template_design_confirmation）
 *   ② 硬编码占位模板生成（buildSkuCardTemplatePreparationPlan，v4 版式脚本）
 * 且「确认卡确认后」与「缺模板+生产措辞（shouldAutoPrepareSkuCardTemplateForProduction）」
 * 都会落到 ②——用户观察到的"有概率用硬编码"即来源于此。
 *
 * 新语义（单一真相源在本模块）：
 *   - 默认路径（用户只说做 SKU 且无模板）→ 确认模板方向 → 移交 Agent 自主设计
 *     （参考先行 → 设计 → 观察 → createSkuPlaceholders 加占位 → inspectTemplateLayout 验证 →
 *      存入 模板文件/ → 回到批量）。
 *   - 硬编码占位模板只在两种情况可达：用户话语显式要求快速/默认/占位模板，
 *     或 Agent 设计路径失败后用户选择了兜底选项（params.skuPlaceholderTemplateFallbackApproved）。
 *   - 占位模板产物命名与完成消息必须明示「通用占位模板（非设计稿）」。
 *
 * 红线：本模块给模型机制、不替模型决策——门禁拦「无参考观察/无占位」，不拦「路径」；
 * 每个拒绝都指路当前状态下真实可达的动作（门禁出口治理惯例，见 design-discipline-runtime）。
 */

import { SKU_TEMPLATE_DESIGN_TASK_TYPE_ID } from './design-task-types';

export type SkuTemplatePreparationRouteId =
    | 'placeholder_preparation'
    | 'agent_design_handoff'
    | 'confirmation_required'
    | 'blocked_missing_template';

export interface SkuTemplatePreparationRoute {
    route: SkuTemplatePreparationRouteId;
    reason: string;
}

/**
 * 用户是否显式要求「快速/默认/占位」模板兜底（而非设计稿）。
 * 刻意保守：必须同时出现「快速出一版 / 默认 / 占位 / 通用 / 兜底 / 就行 / 先顶」这类降级措辞
 * 与「模板」语境，避免把"没有模板，帮我设计一版"这类设计请求误判成兜底请求。
 */
export function hasExplicitSkuPlaceholderTemplateFallbackText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text) return false;
    // 明确点名"占位模板 / 默认模板 / 通用模板 / 基础占位"即视为显式兜底
    if (/(?:占位模板|默认模板|通用(?:占位)?模板|基础占位(?:模板)?|placeholder\s*template)/i.test(text)) {
        // 但"不要占位模板 / 别用默认模板"属于反向表述，不算显式要求
        if (/(?:不要|别|不用|无需|不需要|拒绝)[^。！？!?；;\n]{0,12}(?:占位模板|默认模板|通用(?:占位)?模板|基础占位)/.test(text)) {
            return false;
        }
        return true;
    }
    // "快速出一版模板就行 / 先随便出一版模板顶一下"——降级措辞 + 模板语境
    const quickFallbackWording = /(?:快速|随便|先随便|简单|粗略)[^。！？!?；;\n]{0,16}(?:出|来|做|生成|建)[^。！？!?；;\n]{0,10}一版[^。！？!?；;\n]{0,12}模板/.test(text)
        || /模板[^。！？!?；;\n]{0,16}(?:就行|先顶一下|先顶着|凑合|将就)/.test(text);
    return quickFallbackWording;
}

/** 用户是否在模板方向确认卡上明确拒绝/要求调整（与执行器确认解析的负向分支同一口径）。 */
export function hasDeclinedSkuCardTemplateDesignText(input: string): boolean {
    const text = String(input || '').trim();
    if (!text) return false;
    return /(?:模板方向确认|允许先生成可编辑基础模板)[:：]\s*(?:否|不|false|no|需要调整)/i.test(text);
}

export interface ResolveSkuTemplatePreparationRouteInput {
    userInput: string;
    params?: Record<string, any> | null;
    /** 模板方向是否已确认（确认卡确认文本或 params.skuCardTemplateDesignApproved）。 */
    templateDesignConfirmed: boolean;
}

/**
 * 缺模板时的唯一路由决策：显式兜底 > 明确拒绝 > 已确认方向（移交 Agent 设计）> 默认（先确认方向）。
 * 注意：本函数只在「按规格确认缺模板」后调用；模板可用时不进入本路由。
 */
export function resolveSkuTemplatePreparationRoute(
    input: ResolveSkuTemplatePreparationRouteInput
): SkuTemplatePreparationRoute {
    const params = input.params && typeof input.params === 'object' ? input.params : {};
    const userInput = String(input.userInput || '');

    if (
        params.skuPlaceholderTemplateFallbackApproved === true
        || hasExplicitSkuPlaceholderTemplateFallbackText(userInput)
    ) {
        return {
            route: 'placeholder_preparation',
            reason: '用户显式要求快速/默认/占位模板兜底，允许生成通用占位模板（非设计稿）。'
        };
    }

    if (hasDeclinedSkuCardTemplateDesignText(userInput)) {
        return {
            route: 'blocked_missing_template',
            reason: '用户在模板方向确认卡上明确要求调整，本轮不推进模板生成，等待用户给出新的方向。'
        };
    }

    if (input.templateDesignConfirmed) {
        return {
            route: 'agent_design_handoff',
            reason: '模板方向已确认，移交 Agent 自主设计模板（参考先行 → 设计 → 占位符 → 验证 → 存模板）。'
        };
    }

    return {
        route: 'confirmation_required',
        reason: '缺少可用 SKU 模板且用户未显式要求占位兜底，默认先确认模板方向，再移交 Agent 自主设计。'
    };
}

/** Agent 自主设计模板的移交契约状态（与 skill-tools 阶段移交同一状态词）。 */
export const SKU_TEMPLATE_DESIGN_HANDOFF_STATUS = 'pending_sku_template_design_agent_decision';

export interface SkuTemplateDesignHandoffContract {
    status: typeof SKU_TEMPLATE_DESIGN_HANDOFF_STATUS;
    audience: 'agent';
    message: string;
    /**
     * 移交续跑的确定性纪律激活通道（评审修复 2026-07-03）：执行器在拿到移交结果后，
     * 以该任务类型 id 显式激活设计纪律上下文（resolveDesignDisciplineContext 的
     * declaredTaskTypeId 输入），不再依赖用户措辞正则/行为足迹——否则参考先行门禁
     * 在移交路径不可达（激活要么缺创意信号、要么晚于 createDocument、要么被
     * excludeSignals 文本误杀）。
     */
    declaredDesignTaskTypeId: string;
    /** 参考先行：设计前至少一条参考观察的可达工具（与 design-discipline-runtime 门禁同一口径）。 */
    requiredReferenceObservationTools: string[];
    /** 设计完成后的占位闭环步骤（确定性顺序，缺一不可进入批量）。 */
    completionChecklist: string[];
}

export function buildSkuTemplateDesignHandoffContract(input: {
    missingSizes: number[];
    colorCount?: number;
}): SkuTemplateDesignHandoffContract {
    const sizesText = (input.missingSizes || []).length > 0
        ? input.missingSizes.map((size) => `${size}双装`).join('、')
        : '所需规格';
    const colorText = Number(input.colorCount) > 0 ? `（当前色卡 ${input.colorCount} 色）` : '';
    const requiredReferenceObservationTools = [
        'searchEagleReferences',
        'searchDesignKnowledge',
        'analyzeAssetContent'
    ];
    const completionChecklist = [
        `设计前先取得至少一条参考观察：searchEagleReferences 检索版式参考 / searchDesignKnowledge 检索设计知识 / analyzeAssetContent 分析用户或项目内参考图，不允许凭空设计。`,
        `用通用 Photoshop 工具为 ${sizesText} 设计可编辑模板${colorText}，改动后用截图观察真实画面。`,
        '添加占位符也是排版设计：先用截图和 getLayerBounds 读取已设计版面，再选择 ordered_slots（6.3，一色一槽，物理槽数=双数）或 region_composition（6.0，一个矩形区域可放多色，显式 regionCapacities 总和=双数）；把规划好的 slots 显式传给 createSkuPlaceholders，只有空白裸模板才允许只传 count 让工具均分。',
        '用 skuLayout 的 inspectTemplateLayout 读取 layerId/type/panelIndex/bounds 并形成 TemplateLayoutPlan；调整现有占位时用 transformLayer 修改目标 layerId 后重新 inspect，不要新建第二套占位。',
        '用 saveDocument 把模板存入项目「模板文件」目录，命名用规格本身、与用户既有模板同风格（组合模板如「3双装」，自选备注模板如「3双装自选备注」；不要用「通用占位」「卡片模板v4」这类生成器命名）。',
        '模板齐备后再回到 sku-batch 继续组合确认与批量出图；此时带上 skuCardTemplateDesignApproved=true 表明模板方向已确认，避免再次被移交回设计阶段。'
    ];
    const message = [
        `当前项目缺少 ${sizesText} 的排版模板，模板方向已确认：现在进入 SKU 模板设计阶段，由 Agent 自主设计，不使用通用占位脚本代替设计稿。`,
        `设计闭环要求（按顺序执行）：`,
        ...completionChecklist.map((item, index) => `${index + 1}. ${item}`)
    ].join('\n');
    return {
        status: SKU_TEMPLATE_DESIGN_HANDOFF_STATUS,
        audience: 'agent',
        message,
        declaredDesignTaskTypeId: SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
        requiredReferenceObservationTools,
        completionChecklist
    };
}

// ── 设计后占位闭环：模板进入批量前的确定性检查 ──

export interface SkuTemplatePlaceholderBatchEntryGateInput {
    size: number;
    action: 'execute' | 'arrangeDynamic';
    templateName?: string;
    expectedItemCount: number;
    /** 来自 skuLayout inspectTemplateLayout 的预检结果（sku-auto-layout-executor-policy）。 */
    placeholderCount: number;
    skuPlaceholderInspectionStatus: string;
    hasReliableSkuPlaceholders: boolean | undefined;
}

export interface SkuTemplatePlaceholderBatchEntryGateBlock {
    size: number;
    action: 'execute' | 'arrangeDynamic';
    templateName: string;
    expectedItemCount: number;
    placeholderCount: number;
    message: string;
}

/**
 * 模板文档（含 Agent 设计产物）没有可解析占位符时，不得被当作模板进入批量。
 * 拒绝消息指路 createSkuPlaceholders（补占位）→ inspectTemplateLayout（复验），
 * 而不是只说"结构不可用"。仅在检查状态为 inspected 且判定不可靠时拦截——
 * 检查失败/未检查不在此拦（无占位符自动排版能力另有 runtime readiness 门，口径不变）。
 */
export function evaluateSkuTemplatePlaceholderBatchEntryGate(
    input: SkuTemplatePlaceholderBatchEntryGateInput
): SkuTemplatePlaceholderBatchEntryGateBlock | null {
    if (input.skuPlaceholderInspectionStatus !== 'inspected') return null;
    if (input.hasReliableSkuPlaceholders !== false) return null;

    const actionLabel = input.action === 'arrangeDynamic' ? '自选备注' : '组合图';
    const templateName = String(input.templateName || '').trim() || '未命名模板';
    const message = [
        `${input.size}双${actionLabel}: 模板「${templateName}」没有识别到可解析的 SKU 占位符，不能作为模板进入批量出图。`,
        `本次规格包含 ${input.expectedItemCount} 个颜色，当前识别到 ${input.placeholderCount} 个物理占位。`,
        '请先用 skuLayout.inspectTemplateLayout 确认模板应采用 ordered_slots（一槽一色）还是 region_composition（矩形区域多色）；',
        '需要新建时用 createSkuPlaceholders 传入对应 placementMethod，区域模式还要传显式 regionCapacities；',
        '需要调整时用检查结果中的 layerId 调用 transformLayer，再次 inspect 复验后重试。'
    ].join(' ');

    return {
        size: input.size,
        action: input.action,
        templateName,
        expectedItemCount: input.expectedItemCount,
        placeholderCount: input.placeholderCount,
        message
    };
}
