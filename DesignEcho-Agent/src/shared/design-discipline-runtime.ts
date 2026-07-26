/**
 * 通用设计纪律运行时（generic, data-driven design discipline runtime）
 *
 * 背景：详情页「从零设计」此前在 autonomous-agent.executor.ts 里以一整套硬编码
 * 状态机（freshDetailPage*）实现——检测靠正则、工具靠详情页专属白名单、门禁顺序
 * 写死。这违反「技能不渗透进 Agent」不变量，且只覆盖手写过正则的品类。
 *
 * 本模块把其中真正跨任务的**运行不变量**（真实状态、防重复建档、写后观察、保存前复核）
 * 与仍在迁移中的显式 Skill policy（stagePlan / reference-first）整理成纯逻辑：
 *   - 任务类型来自 design-task-types.ts（详情页/主图/SKU/未来新品类=加数据）
 *   - 看图纪律来自 design-observation-intents.ts（DESIGN_OBSERVATION_REQUIREMENTS）
 *   - 方法论工具由现有 Skill Manifest 明确声明，并绑定其 knowledge_refs
 *
 * 通用 Harness 不再通过本模块缩窄 Tool Registry，也不再强制「方法论→建档→renderLayout」路线。
 * Skill policy 后续继续迁入 manifest；本模块保持纯逻辑、无 Photoshop / 无 renderer 依赖，可被 smoke 验证。
 *
 * 治理轨道见 CLAUDE.md「设计能力治理（D→B→A）」；本模块是 A1 的通用替身，
 * A1.2 把 executor 改调它后，audit:executor-generic 棘轮随之下降。
 */

import { DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID } from './agent-runtime-v5/capability-provider-identities';
import { getManifestByTaskType } from './agent-runtime-v5/skill-runtime';
import {
    resolveDesignTaskTypeSpec,
    getDesignTaskTypeSpec,
    hitsAnyDesignTaskExcludeSignal,
    GENERIC_DESIGN_TASK_TYPE,
    type DesignTaskTypeSpec
} from './design-task-types';
import {
    DESIGN_OBSERVATION_REQUIREMENTS,
    type DesignObservationIntent,
    type DesignObservationRequirement
} from './design-observation-intents';
import { validateCreativeStagePlan } from './creative-stage-plan';
import { classifyPhotoshopToolSkillExecution } from './photoshop-tool-skill';

export type DesignDisciplineRuntimeVersion = typeof DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID;

function resolveFrameworkToolName(spec: DesignTaskTypeSpec): string {
    const manifest = getManifestByTaskType(spec.id);
    const ref = manifest?.primary_method_tool_ref;
    return ref && manifest?.knowledge_refs?.includes(ref) ? ref.slice('tool:'.length) : 'searchDesignKnowledge';
}

/**
 * 设计治理上下文：是否进入设计纪律/Skill policy 治理 + 命中的任务类型 + 方法论工具。
 * active = 创意设计意图（由 executor 的控制面信号提供，本模块不重造意图正则）且命中数据驱动任务类型。
 * active 不等于固定「从零创建」路线；编辑、检查和导出仍由 Planner 按真实目标选择。
 */
export interface DesignDisciplineContext {
    version: DesignDisciplineRuntimeVersion;
    active: boolean;
    spec?: DesignTaskTypeSpec;
    taskTypeId?: string;
    label?: string;
    /** 该任务类型的方法论工具（如 getDetailPageDesignFramework）；无专属时为 searchDesignKnowledge */
    frameworkToolName: string;
    /**
     * 该品类的 renderLayout 是否必须携带阶段计划 stagePlan（从 spec.requiresStagePlanOnRender 派生）。
     * 默认 false——只有声明了阶段计划契约的品类（如详情页从零设计）才启用。
     */
    requiresStagePlan: boolean;
    /**
     * 新建画布前是否必须先读取参考输入（从 spec.requiresReferenceInputBeforeDocument 派生）。
     * 启用的品类（如 SKU 模板设计）在拿到 searchEagleReferences / searchDesignKnowledge /
     * analyzeAssetContent 等任一参考输入（或用户自带参考来源）之前，createDocument 会被门禁拦下并指路。
     * 该门禁只检查是否已有参考输入，不限定获取路径；启用时参考类工具无条件放行并暴露给模型。
     */
    requiresReferenceInput: boolean;
    /**
     * 该品类的目标文档规范名（从 spec.canonicalDocumentName 派生）。
     * 用于 stagePlan.targetDocumentName 一致性校验；无则不做文档名校验。
     */
    canonicalDocumentName?: string;
    /**
     * 编辑模式：目标品类文档已在前台打开（activeDocumentName 含 canonicalDocumentName）——
     * 任务是存量修改而非从零设计。requiresStagePlan 自动降级；createDocument 被守卫拦下。
     * 只有 Harness 已从结构化目标判定为独立交付物时，才能通过可信授权放行。
     */
    editingExistingCanonicalDocument: boolean;
    /**
     * 用户是否给出了明确的参考来源（参考链接 / 复刻 / 对标）。
     * 由调用方（executor）基于其正则 helper 传入，runtime 不重造意图正则；默认 false。
     * 用于放行 reference 类工具（searchEagleReferences / searchDesignKnowledge / fetchWebPageDesignContent 等）。
     */
    hasReferenceSource: boolean;
}

export function resolveDesignDisciplineContext(input: {
    taskText?: string;
    isCreativeDesignIntent?: boolean;
    /**
     * 结构化声明的任务类型 id（评审修复 2026-07-03）：来自移交契约（如 SKU 模板设计移交
     * data.declaredDesignTaskTypeId）、控制面信号映射（CONTROL_PLANE_SIGNAL_TASK_TYPE_MAP）
     * 或模型自身声明。命中注册品类时**确定性激活**——优先于 taskText 关键词匹配，且不受
     * excludeSignals 文本启发式影响（确认卡重提交文本里的「出图」等措辞不再误杀纪律激活），
     * 也不要求 isCreativeDesignIntent（部分品类的控制面信号不含 explicit_creative_design）。
     * 数据驱动：只做 id 查表，不做任何文本猜测；未注册的 id 不激活（回落原有判定）。
     */
    declaredTaskTypeId?: string;
    /** 用户是否给出明确参考来源；由调用方基于其正则 helper 传入，默认 false。 */
    hasReferenceSource?: boolean;
    /**
     * 当前活动文档名（真机病例 2026-07-07）：目标品类文档已打开（如「详情页.psb」在前台）
     * 时，任务是对存量文档的修改而非从零设计——纪律进入编辑模式：不逐屏出稿（requiresStagePlan
     * 降级）、createDocument 被守卫拦下指路（曾在读取失败误导下于存量详情页旁另建空文档）。
     */
    activeDocumentName?: string;
}): DesignDisciplineContext {
    const declaredSpec = getDesignTaskTypeSpec(input.declaredTaskTypeId);
    let spec = declaredSpec || resolveDesignTaskTypeSpec(input.taskText);
    if (!spec && input.isCreativeDesignIntent && !hitsAnyDesignTaskExcludeSignal(input.taskText)) {
        // 通用兜底：确定是创意设计意图（isCreativeDesignIntent 来自控制面，非关键词）、不匹配任何
        // 具体品类（海报 / 小红书 / Banner …）、且不命中"非从零设计"排除信号（检查/填充/导出/保存）
        // → 仍继承通用设计纪律，不靠逐品类堆关键词（理解优于硬编码）。
        // generic 无 stagePlan / 无文档名校验 / 只用通用核心工具集。
        spec = GENERIC_DESIGN_TASK_TYPE;
    }
    const active = Boolean(declaredSpec) || (Boolean(input.isCreativeDesignIntent) && Boolean(spec));
    const hasReferenceSource = Boolean(input.hasReferenceSource);
    if (!active || !spec) {
        return {
            version: DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID,
            active: false,
            frameworkToolName: 'searchDesignKnowledge',
            requiresStagePlan: false,
            requiresReferenceInput: false,
            editingExistingCanonicalDocument: false,
            hasReferenceSource
        };
    }
    // 编辑模式（真机病例 2026-07-07）：目标品类文档已在前台打开 → 任务是存量修改而非从零设计。
    // 从零纪律的两个假设不成立：不需要逐屏出稿（requiresStagePlan 降级），更不能新建同类文档
    // （createDocument 由守卫拦下指路 switchDocument——曾在「读取失败误导+从零纪律引导」叠加下
    // 于 116 层存量详情页旁另建空文档）。改后必看等纪律不受影响。
    const editingExistingCanonicalDocument = Boolean(
        spec.canonicalDocumentName
        && String(input.activeDocumentName || '').includes(spec.canonicalDocumentName)
    );
    return {
        version: DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID,
        active: true,
        spec,
        taskTypeId: spec.id,
        label: spec.label,
        frameworkToolName: resolveFrameworkToolName(spec),
        requiresStagePlan: Boolean(spec.requiresStagePlanOnRender) && !editingExistingCanonicalDocument,
        requiresReferenceInput: Boolean(spec.requiresReferenceInputBeforeDocument),
        canonicalDocumentName: spec.canonicalDocumentName,
        editingExistingCanonicalDocument,
        hasReferenceSource
    };
}

/** 是否进入从零设计纪律（薄封装，便于 executor 直接替换 isFreshDetailPageDesignTask） */
export function isDesignDisciplineTask(input: {
    taskText?: string;
    isCreativeDesignIntent?: boolean;
}): boolean {
    return resolveDesignDisciplineContext(input).active;
}

/** 改动类工具（触发「改后必看」纪律） */
export const DESIGN_DISCIPLINE_MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
    'renderLayout',
    'placeImage',
    'transformLayer',
    'fitLayerSubjectToRegion',
    'moveLayer',
    'setTextStyle',
    'setTextContent',
    'fixLayerIssues',
    'fillDetailPage',
    // replaceLayerContent 随放行集纳入（2026-07-02）：它替换画面内容，同样受
    // 「改后必看」与「不无限微调」纪律约束，不开无观察的写入旁路。
    'replaceLayerContent'
]);

/**
 * 是否为会改变 Photoshop 结果的设计动作。
 * 显式集合保留观察意图的稳定语义；Tool Registry 的执行分类补齐新增原子工具，
 * 避免每增加一个 Tool 都必须回到设计 Harness 手工登记才能触发「写后观察」。
 */
export function isDesignDisciplineMutationTool(
    toolName: string,
    classifiedAsPhotoshopMutation?: boolean
): boolean {
    if (classifiedAsPhotoshopMutation === true) return true;
    if (DESIGN_DISCIPLINE_MUTATION_TOOL_NAMES.has(toolName)) return true;
    if (toolName === 'createDocument') return false;
    return classifyPhotoshopToolSkillExecution(toolName) === 'photoshop_write';
}

/** 视觉/结构复核工具（满足「改后必看」） */
export const DESIGN_DISCIPLINE_VISUAL_REVIEW_TOOL_NAMES: ReadonlySet<string> = new Set([
    'getAcceptanceSnapshot',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getLayerBounds',
    'getLayerProperties',
    'getAllTextLayers',
    'getClippingMaskInfo',
    'getAllClippingMasks'
]);

/** 保存/导出工具 */
export const DESIGN_DISCIPLINE_EXPORT_TOOL_NAMES: ReadonlySet<string> = new Set([
    'saveDocument',
    'quickExport',
    'smartSave',
    'exportDetailPageSlices',
    // 用户导出规范 4.0（2026-07-07）：主图/详情页批量导出，同受「改后未复核不许导出」纪律约束
    'exportMainImageDocuments'
]);

/**
 * 观察类工具（只读 / 打开既有 / 查看结构 / 看画面）——Harness「Observation 必须永远畅通」的载体。
 *
 * 设计纪律**绝不拦这些工具**（含建画布之前）：让 Agent 随时能打开并看清它被问的文件。
 * 真机病例（2026-07-08「帮我导出主图详情页」被误判从零设计）：openTemplate / getLayerHierarchy
 * 在建画布前被拦 → Agent 看不到"这其实是张做好的详情页" → 只能顺着牢笼去 createDocument。
 * 读不产生破坏性写入；防套版 / 防旁建空文档由写路径门禁与 2.2b 编辑模式保证，不靠"致盲"Agent。
 *
 * 刻意**不含**：
 *  - 方法论工具（getDetailPageDesignFramework 等）——受「读一次别重复读」停机约束；
 *  - 素材分析工具（analyzeAssetContent 等）——受「别反复分析空耗本轮」上限约束；
 *  - 参考检索（searchEagleReferences / searchDesignKnowledge）——有各自的参考通道处理。
 */
export const DESIGN_DISCIPLINE_OBSERVATION_TOOL_NAMES: ReadonlySet<string> = new Set([
    // 打开 / 切换既有文档
    'openTemplate',
    'openProjectFile',
    'openDocument',
    'listDocuments',
    'switchDocument',
    // 文档 / 画面读取
    'getDocumentInfo',
    'getDocumentSnapshot',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getAcceptanceSnapshot',
    'diagnoseState',
    // 图层 / 文本 / 智能对象读取
    'getLayerHierarchy',
    'findLayers',
    'getLayerBounds',
    'getLayerProperties',
    'getAllTextLayers',
    'getClippingMaskInfo',
    'getAllClippingMasks',
    'getTextContent',
    'getTextStyle',
    'getSmartObjectInfo',
    'getSmartObjectLayers',
    'getElementMapping',
    'analyzeLayout',
    'getHistoryInfo',
    'getSkuPlaceholders'
]);

/** 是否为观察类工具（永远放行，不受设计纪律拦截）。 */
export function isDesignDisciplineObservationTool(toolName: string): boolean {
    return DESIGN_DISCIPLINE_OBSERVATION_TOOL_NAMES.has(toolName);
}

/**
 * 参考输入工具（参考先行门禁的数据来源，治理2026-07-02）：
 * searchEagleReferences（Eagle 只读参考）/ searchDesignKnowledge（设计知识命中）/
 * analyzeAssetContent（分析用户或项目内参考图，resource-manager 富分析的循环入口）/
 * design-reference-search（参考检索技能）/ fetchWebPageDesignContent（网页参考）。
 * 任一成功调用计入 referenceInputCount；用户消息自带参考来源等价于已有一项参考输入。
 */
export const DESIGN_DISCIPLINE_REFERENCE_INPUT_TOOL_NAMES: ReadonlySet<string> = new Set([
    'searchEagleReferences',
    'searchDesignKnowledge',
    'analyzeAssetContent',
    'design-reference-search',
    'fetchWebPageDesignContent',
    // 设计源解析（PSD 知识库 P0）：设计师 PSD/PSB 的结构与度量是高保真参考输入
    'analyzePsdDesignSource',
    // 浏览器扩展读页/截图：用户浏览器里的参考页也属于参考输入
    'readBrowserPage',
    'captureBrowserTab',
    // Eagle 素材真实视觉观察（P3）：亲眼看过选中/检索到的 Eagle 素材当然是参考输入
    'observeEagleAsset'
]);

// ── 纪律状态机（纯函数 reducer，便于 smoke 与 executor 共用一套真相） ──

export interface DesignDisciplineState {
    documentCreated: boolean;
    layoutRendered: boolean;
    designKnowledgeReadCount: number;
    /** 参考输入计数（参考先行门禁）：DESIGN_DISCIPLINE_REFERENCE_INPUT_TOOL_NAMES 成功调用数 */
    referenceInputCount: number;
    frameworkReadCount: number;
    needsObservationAfterMutation: boolean;
    observationIntent?: DesignObservationIntent;
    repairAttemptCount: number;
    lastMutationToolName?: string;
}

export function createDesignDisciplineState(init?: Partial<DesignDisciplineState>): DesignDisciplineState {
    return {
        documentCreated: Boolean(init?.documentCreated),
        layoutRendered: Boolean(init?.layoutRendered),
        designKnowledgeReadCount: init?.designKnowledgeReadCount ?? 0,
        referenceInputCount: init?.referenceInputCount ?? 0,
        frameworkReadCount: init?.frameworkReadCount ?? 0,
        needsObservationAfterMutation: Boolean(init?.needsObservationAfterMutation),
        observationIntent: init?.observationIntent,
        repairAttemptCount: init?.repairAttemptCount ?? 0,
        lastMutationToolName: init?.lastMutationToolName
    };
}

/** 根据改动工具推断要做的观察意图（generic：置图/换图→image_fit、文字→text_readability、其余→stage_readiness） */
export function inferObservationIntentForTool(toolName: string): DesignObservationIntent {
    if (toolName === 'placeImage' || toolName === 'transformLayer' || toolName === 'replaceLayerContent') return 'image_fit';
    if (toolName === 'setTextStyle' || toolName === 'setTextContent') return 'text_readability';
    return 'stage_readiness';
}

/** 纯函数：把一次成功的工具调用推进到下一个纪律状态（不可变更新） */
export function applyDesignDisciplineProgress(
    state: DesignDisciplineState,
    toolName: string,
    succeeded: boolean,
    context: { frameworkToolName: string; isPhotoshopMutation?: boolean }
): DesignDisciplineState {
    if (!succeeded) return state;
    const next: DesignDisciplineState = { ...state };
    const hadPendingObservation = next.needsObservationAfterMutation;

    if (toolName === 'createDocument') next.documentCreated = true;

    if (toolName === 'renderLayout') {
        next.layoutRendered = true;
        next.needsObservationAfterMutation = true;
        next.observationIntent = 'stage_readiness';
    }

    if (isDesignDisciplineMutationTool(toolName, context.isPhotoshopMutation)) {
        // 连续写入但尚未观察时累计修正次数；不再以「是否先调用 renderLayout」作为计数前提。
        if (hadPendingObservation) {
            next.repairAttemptCount += 1;
        }
        next.needsObservationAfterMutation = true;
        next.lastMutationToolName = toolName;
        // 对齐详情页守卫语义：置图/变换→image_fit、文字→text_readability、
        // 其他改动工具只在观察意图未设时落 stage_readiness（不覆盖已有的更具体意图，
        // 例如 transformLayer 设的 image_fit 不应被随后的 moveLayer 改写成 stage_readiness）。
        if (toolName === 'placeImage' || toolName === 'transformLayer' || toolName === 'replaceLayerContent') {
            next.observationIntent = 'image_fit';
        } else if (toolName === 'setTextStyle' || toolName === 'setTextContent') {
            next.observationIntent = 'text_readability';
        } else if (!next.observationIntent) {
            next.observationIntent = 'stage_readiness';
        }
    }

    if (
        toolName === 'searchDesignKnowledge'
        || toolName === 'getDesignPrinciples'
        || toolName === 'searchEagleReferences'
        || toolName === context.frameworkToolName
    ) {
        // searchEagleReferences：Eagle 素材参考检索也算"开稿前的设计依据"，让参考检索成为开稿纪律的一部分。
        // Tool 可达性由统一 Registry / Capability Resolver 管理；本纪律只记录成功读取，不维护暴露清单。
        next.designKnowledgeReadCount += 1;
    }
    if (DESIGN_DISCIPLINE_REFERENCE_INPUT_TOOL_NAMES.has(toolName)) {
        // 参考先行门禁（治理2026-07-02）：记录已成功读取的 Eagle 参考 / 设计知识 / 参考图分析结果。
        next.referenceInputCount += 1;
    }
    if (toolName === context.frameworkToolName) {
        next.frameworkReadCount += 1;
    }

    if (DESIGN_DISCIPLINE_VISUAL_REVIEW_TOOL_NAMES.has(toolName)) {
        next.needsObservationAfterMutation = false;
        next.repairAttemptCount = 0;
    }

    return next;
}

// ── 通用门禁：复现 freshDetailPage 的纪律顺序，但品类无关、文案用任务类型标签 ──

export interface DesignToolStateGuardResult {
    success: false;
    message: string;
    error: string;
    nextRequiredTool?: string;
    nextRequiredToolReason?: string;
}

export interface DesignToolStateGuardInput {
    context: DesignDisciplineContext;
    state: DesignDisciplineState;
    toolName: string;
    /** 工具入参（renderLayout 的 stagePlan 校验需要）。 */
    toolParams?: Record<string, any>;
    /** Harness 统一 Tool Registry 的执行分类结果；用于识别 Skill bridge 内的 Photoshop 写入。 */
    isPhotoshopMutation?: boolean;
    /** 仅由 Harness 根据结构化执行目标签发；模型 Tool 参数不能提供或覆盖。 */
    trustedCreateDocumentAuthorization?: boolean;
}

/**
 * renderLayout 的通用阶段计划校验：结构由 creative-stage-plan 契约负责，
 * 文档规范名来自当前 Skill / 任务上下文。Harness 不推断任务品类，也不依赖详情页专属校验器。
 */
function validateDesignDisciplineStagePlan(
    context: DesignDisciplineContext,
    stagePlan: unknown
): { valid: boolean; blockers: string[] } {
    const expectedDocumentName = String(context.canonicalDocumentName || '').trim() || undefined;
    const base = validateCreativeStagePlan(stagePlan, { expectedDocumentName });
    return { valid: base.valid, blockers: base.blockers };
}

/**
 * 通用设计纪律门禁：未激活时返回 null（不拦截）。激活时只保留跨任务安全与运行不变量，
 * 以及仍在迁移中的显式 Skill policy（stagePlan / reference-first）。它不再承担工具白名单、
 * 强制新建画布或强制 renderLayout 等路线选择。
 */
/**
 * 守卫计算上下文（computedCtx）：级联前算一次的共享前置 + 惰性缓存，供所有 DisciplineRule 复用。
 * 这是「policy-as-code」的求值环境——规则的 when/build 只读它，不各自重算，也不碰 input 之外的状态。
 */
interface DesignToolStateGuardComputedContext {
    context: DesignDisciplineContext;
    state: DesignDisciplineState;
    toolName: string;
    toolParams?: Record<string, any>;
    isPhotoshopMutation: boolean;
    trustedCreateDocumentAuthorization: boolean;
    /** 任务类型标签（context.label || '设计'），所有文案避免写死「详情页」。 */
    label: string;
    /** 该品类方法论工具（context.frameworkToolName）；block-1 的比较对象、多规则的指路目标。 */
    framework: string;
    /** 观察意图配置（含 purpose/observationTools/maxRepairAttempts）；block-2 与 block-7 消费。 */
    observation: DesignObservationRequirement;
    /** 微调上限下界保护（Math.max(1, observation.maxRepairAttempts)）；唯一消费点是 block-2。 */
    maxRepairAttempts: number;
    /**
     * 惰性缓存 block-0 的 stagePlan 校验结果：when 判「!valid」与 build 取「blockers.slice(0,4)」共用，
     * 只调用一次 validateDesignDisciplineStagePlan（纯函数），避免重复计算。
     */
    stagePlanValidation(): { valid: boolean; blockers: string[] };
}

/**
 * 规则大类（β 元数据，为未来单一 manifest 铺路）：便于审计与文档生成按类聚合，不参与判定。
 */
type DisciplineRuleCategory =
    | 'stage-plan'
    | 'framework-halt'
    | 'redo-cap'
    | 'edit-mode'
    | 'reference-first'
    | 'no-recreate'
    | 'observe-before-export';

/**
 * 结构化治理历史（β 元数据）：把 note 里的历史修复来由拆成 { date, note } 条目，
 * 便于后续审计与文档生成机读；不参与判定，纯机构记忆。
 */
interface DisciplineRuleGovernanceEntry {
    /** 修复日期（YYYY-MM-DD），对应 note 里记录的真机病例/评审修复/Harness 修正。 */
    date: string;
    /** 该次修复的简述（来由）。 */
    note: string;
}

/**
 * 声明式纪律规则：把原来 evaluateDesignToolStateGuard 里的一条 if 块抽成
 * { id, category, note(治理注释/机构记忆), governanceHistory, when(命中判定), build(拦截结果) }。
 * 顺序即语义——数组顺序 = 原块顺序，后面的规则隐含「前面没命中」（级联早返回语义）。
 */
interface DisciplineRule {
    id: string;
    /** 规则大类（β 元数据）：审计/文档聚合用，不参与判定。 */
    category: DisciplineRuleCategory;
    /** 治理注释：记录该块的真实历史修复（机构记忆），不得丢失。 */
    note: string;
    /** 结构化治理历史（β 元数据，可选）：note 里带日期的关键修复的机读形式。 */
    governanceHistory?: DisciplineRuleGovernanceEntry[];
    when(ctx: DesignToolStateGuardComputedContext): boolean;
    build(ctx: DesignToolStateGuardComputedContext): DesignToolStateGuardResult;
}

/**
 * 有序设计纪律规则数组（policy-as-code）：从上到下第一个 when 命中即返回 build 结果。
 *
 * 顺序强相关（不可乱序）：
 *  - block-0(stagePlan) 先于 block-2(重做上限)：同为 renderLayout，先校验显式 Skill policy。
 *  - createDocument 处理链：编辑现有文档保护 → 显式 reference-first policy → 防重复建档。
 *  - 写后观察是 Harness 不变量，不依赖是否使用 renderLayout。
 */
const DESIGN_TOOL_STATE_GUARD_RULES: readonly DisciplineRule[] = [
    {
        id: 'block-0-stageplan',
        category: 'stage-plan',
        note: '0) renderLayout 必带阶段计划 stagePlan（仅启用阶段计划契约的品类，如详情页从零设计）。'
            + '文档名校验已下沉到 validateDesignDisciplineStagePlan（按 context.canonicalDocumentName 参数化），不写死「详情页」字面量。',
        when: (c) =>
            c.toolName === 'renderLayout'
            && c.context.requiresStagePlan
            && !c.stagePlanValidation().valid,
        build: (c) => {
            const message = [
                `当前是从零${c.label}设计，renderLayout 需要携带 Agent 自己形成的阶段计划 stagePlan。`,
                ...c.stagePlanValidation().blockers.slice(0, 4)
            ].join('\n');
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'renderLayout',
                nextRequiredToolReason: `请先基于项目上下文和${c.label}方法论明确当前阶段计划，再用同一次 renderLayout 执行该阶段草稿。`
            };
        }
    },
    {
        id: 'block-1-framework-repeat',
        category: 'framework-halt',
        note: '1) 已读过方法论后不要重复读。停机约束：方法论工具受「读一次别重复读」，故 framework 工具刻意不进 OBSERVATION 永远放行集。',
        when: (c) => c.toolName === c.framework && c.state.frameworkReadCount >= 1,
        build: (c) => {
            const nextRequiredTool = c.state.documentCreated
                ? 'getCanvasSnapshot'
                : 'getDesignProjectState';
            const message = `已经读取过${c.label}方法论，请基于已有知识和当前任务状态自主选择下一步，不要重复读取同一个方法论工具。`;
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool,
                nextRequiredToolReason: c.state.documentCreated
                    ? '先观察当前画面，再由 Planner 决定继续修改、调用 Skill 或进入评价。'
                    : '先读取项目状态与已有上下文，再由 Planner 决定是否建档、编辑现有文档或补充输入。'
            };
        }
    },
    {
        id: 'block-2-mutation-cap',
        category: 'redo-cap',
        note: '2) 连续写入达到上限时先观察真实画面。该 Harness 不变量适用于所有 Photoshop 写工具，'
            + '不再把 renderLayout 当作唯一重置路径；观察成功后 reducer 会重置修正计数。',
        when: (c) =>
            isDesignDisciplineMutationTool(c.toolName, c.isPhotoshopMutation)
            && c.state.needsObservationAfterMutation
            && c.state.repairAttemptCount >= c.maxRepairAttempts,
        build: (c) => {
            const message = '当前阶段已经连续写入多次但还没有复核真实画面。请先观察，再根据当前画面决定继续修改、调整计划或收尾。';
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: c.observation.observationTools.includes('getAnnotatedSnapshot')
                    ? 'getAnnotatedSnapshot'
                    : 'getCanvasSnapshot',
                nextRequiredToolReason: `连续写入已达到当前观察阈值，需要先查看真实画面：${c.observation.purpose}`
            };
        }
    },
    {
        id: 'block-2.2b-editing-mode-createdoc',
        category: 'edit-mode',
        governanceHistory: [
            { date: '2026-07-07', note: '真机病例：在 116 层存量详情页旁另建空文档；编辑模式下 createDocument 必须由 Harness 的独立目标判定授权。' },
            { date: '2026-07-22', note: '移除模型可自行填写的伪确认参数；授权只来自结构化执行目标。' }
        ],
        note: '2.2b) 编辑模式（真机病例 2026-07-07）：目标品类文档已在前台打开时，任务是存量修改——'
            + '不允许再新建同类文档（曾在「读取失败误导 + 从零纪律引导」叠加下于 116 层存量详情页旁另建空文档）。'
            + '出口真实可达：直接在已打开文档上操作 / switchDocument 切回；另起新档必须由 Harness 先确认它是独立交付目标。',
        when: (c) =>
            c.toolName === 'createDocument'
            && c.context.editingExistingCanonicalDocument
            && !c.trustedCreateDocumentAuthorization,
        build: (c) => {
            const message = `目标「${c.context.canonicalDocumentName || c.label}」文档已经打开，本任务是对它的修改，不要新建文档。`
                + '请直接在已打开的文档上操作（必要时先 switchDocument 切到它）。另起新档必须作为独立交付目标重新发起，不能由模型参数自行确认。';
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'switchDocument',
                nextRequiredToolReason: '存量修改任务应在已打开的目标文档上进行，避免在旁边另建空文档造成双份画布。'
            };
        }
    },
    {
        id: 'block-2.3-reference-first',
        category: 'reference-first',
        governanceHistory: [
            { date: '2026-07-02', note: '参考先行门禁检查 referenceInputCount 与 hasReferenceSource；参考类工具无条件可达，保证指路可通行。' }
        ],
        note: '2.3) 参考先行（治理2026-07-02）：启用 requiresReferenceInput 的品类（如 SKU 模板设计）'
            + '在新建画布前必须至少读取一项参考输入——searchEagleReferences / searchDesignKnowledge / analyzeAssetContent'
            + '（分析用户或项目内参考图）任一成功，或用户消息自带参考来源。'
            + '只检查参考输入是否存在，不规定 Planner 必须通过哪一种参考能力取得。',
        when: (c) =>
            !c.state.documentCreated
            && c.toolName === 'createDocument'
            && c.context.requiresReferenceInput
            && c.state.referenceInputCount + (c.context.hasReferenceSource ? 1 : 0) < 1,
        build: (c) => {
            const message = `这次是${c.label}设计，设计必须有参考、不允许凭空开稿。`
                + '请先读取至少一项参考内容再新建画布：用 searchEagleReferences 检索 Eagle 版式参考、'
                + '或 searchDesignKnowledge 检索设计知识、或 analyzeAssetContent 分析用户/项目内的参考图。';
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'searchEagleReferences',
                nextRequiredToolReason: `${c.label}设计的版式、密度与风格判断需要真实参考；先检索参考（Eagle 不可用时改用 searchDesignKnowledge 或 analyzeAssetContent），再开始画布制作。`
            };
        }
    },
    {
        id: 'block-5-no-recreate-document',
        category: 'no-recreate',
        governanceHistory: [
            { date: '2026-07-02', note: '补状态感知指路：未排版→renderLayout，已排版→getCanvasSnapshot。' }
        ],
        note: '5) 已建画布就别重复新建（门禁出口治理 2026-07-02：补状态感知指路，不再只说"不要做什么"）。'
            + '这是通用幂等保护，不规定后续必须使用 renderLayout。',
        when: (c) => c.state.documentCreated && c.toolName === 'createDocument',
        build: (c) => {
            const message = `本轮已经创建了${c.label}画布，请在当前文档上继续规划、排版、置图或复核，不要再次新建文档。`;
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: 'getDocumentInfo',
                nextRequiredToolReason: '先读取当前文档真实状态，再由 Planner 选择适合本任务的下一项能力。'
            };
        }
    },
    {
        id: 'block-7-observe-before-save',
        category: 'observe-before-export',
        note: '7) 改动后未复核就想保存/导出：先做针对性观察（「改后必看」门禁）。'
            + '它适用于任意 Photoshop 写入路径，不依赖是否调用 renderLayout。'
            + '依赖共享前置 observation（=state.observationIntent 映射 DESIGN_OBSERVATION_REQUIREMENTS，缺省 stage_readiness）。',
        when: (c) =>
            DESIGN_DISCIPLINE_EXPORT_TOOL_NAMES.has(c.toolName)
            && c.state.needsObservationAfterMutation,
        build: (c) => {
            const message = '当前阶段刚调整过画面，还不能直接保存为可验收文件。请先做一次针对性观察，确认画面可读、无遮挡、不重叠后，再决定保存或重排。';
            return {
                success: false,
                message,
                error: message,
                nextRequiredTool: c.observation.observationTools.includes('getAnnotatedSnapshot')
                    ? 'getAnnotatedSnapshot'
                    : 'getCanvasSnapshot',
                nextRequiredToolReason: `当前阶段刚调整过画面，需要先做针对性观察：${c.observation.purpose}`
            };
        }
    }
];

export function evaluateDesignToolStateGuard(
    input: DesignToolStateGuardInput
): DesignToolStateGuardResult | null {
    const { context, state, toolName } = input;
    // 顶层早返回 (a)：纪律未激活（品类未解析或未进入创意设计意图）时不拦截任何工具。
    if (!context.active || !context.spec) return null;

    // 顶层早返回 (b)：Harness「Observation 必须永远畅通」——设计纪律绝不拦只读/打开/查看类工具。
    // 让 Agent 随时能打开并看清它被问的文件——看到"这其实是张做好的详情页"，就能自己纠正
    // 关键词初判（把"导出既有"误判成"从零设计"）。读不产生破坏性写入，防套版/防旁建由写路径门禁保证。
    // 此早返回优先于全部规则，是「读旧文档结构是正当观察」的载体。
    if (isDesignDisciplineObservationTool(toolName)) return null;

    // 共享前置（级联前算一次，多规则复用）。
    const label = context.label || '设计';
    const framework = context.frameworkToolName;
    const observation = state.observationIntent
        ? DESIGN_OBSERVATION_REQUIREMENTS[state.observationIntent]
        : DESIGN_OBSERVATION_REQUIREMENTS.stage_readiness;
    const maxRepairAttempts = Math.max(1, observation.maxRepairAttempts);

    let cachedStagePlanValidation: { valid: boolean; blockers: string[] } | undefined;
    const ctx: DesignToolStateGuardComputedContext = {
        context,
        state,
        toolName,
        toolParams: input.toolParams,
        isPhotoshopMutation: input.isPhotoshopMutation === true,
        trustedCreateDocumentAuthorization: input.trustedCreateDocumentAuthorization === true,
        label,
        framework,
        observation,
        maxRepairAttempts,
        stagePlanValidation() {
            if (!cachedStagePlanValidation) {
                cachedStagePlanValidation = validateDesignDisciplineStagePlan(context, input.toolParams?.stagePlan);
            }
            return cachedStagePlanValidation;
        }
    };

    // 有序级联：第一个 when 命中即返回其 build 结果；全不命中 → null（放行）。
    for (const rule of DESIGN_TOOL_STATE_GUARD_RULES) {
        if (rule.when(ctx)) return rule.build(ctx);
    }
    return null;
}

// ── 通用任务运行记录，品类无关 ──

export type DesignTaskRunStatus = 'completed' | 'needs_review' | 'partial' | 'failed';

export interface DesignTaskRunRecord {
    version: DesignDisciplineRuntimeVersion;
    status: DesignTaskRunStatus;
    canClaimOutputQuality: boolean;
    createdDocumentCount: number;
    renderedStageCount: number;
    observationCount: number;
    savedDocumentCount: number;
    /** 可展示产物数：已保存/导出数优先，否则回退到已排版阶段数（供 UI 概览用）。 */
    outputCount: number;
    warnings: string[];
}

export interface DesignTaskRunToolEntry {
    name: string;
    succeeded: boolean;
    /** 截图/快照只有被视觉模型实际复核后才算画面观察；工具调用成功本身不算。 */
    visualReviewed?: boolean;
}

export function deriveDesignTaskRunRecord(input: {
    executionCompleted: boolean;
    overallSuccess: boolean;
    toolEntries: DesignTaskRunToolEntry[];
    label?: string;
}): DesignTaskRunRecord {
    const ok = (entry: DesignTaskRunToolEntry) => entry.succeeded;
    const createdDocumentCount = input.toolEntries.filter((e) => e.name === 'createDocument' && ok(e)).length;
    const renderedStageCount = input.toolEntries.filter((e) => e.name === 'renderLayout' && ok(e)).length;
    const observationCount = input.toolEntries.filter((e) => (
        DESIGN_DISCIPLINE_VISUAL_REVIEW_TOOL_NAMES.has(e.name)
        && ok(e)
        && e.visualReviewed === true
    )).length;
    const savedDocumentCount = input.toolEntries.filter((e) => DESIGN_DISCIPLINE_EXPORT_TOOL_NAMES.has(e.name) && ok(e)).length;

    const canClaimOutputQuality = input.executionCompleted
        && createdDocumentCount > 0
        && renderedStageCount > 0
        && observationCount > 0
        && savedDocumentCount > 0;

    const status: DesignTaskRunStatus = canClaimOutputQuality
        ? 'completed'
        : !input.overallSuccess && createdDocumentCount === 0 && renderedStageCount === 0
            ? 'failed'
            : createdDocumentCount > 0 && renderedStageCount > 0 && observationCount > 0
                ? 'needs_review'
                : createdDocumentCount > 0 || renderedStageCount > 0
                    ? 'partial'
                    : 'needs_review';

    const label = input.label || '设计';
    const warnings: string[] = [];
    if (createdDocumentCount === 0) warnings.push(`尚未创建${label}文档。`);
    if (renderedStageCount === 0) warnings.push(`尚未完成${label}阶段草稿排版。`);
    if (observationCount === 0) warnings.push(`尚未查看${label}真实画面。`);
    if (savedDocumentCount === 0) warnings.push(`尚未保存或导出${label}结果。`);

    return {
        version: DESIGN_DISCIPLINE_POLICY_CAPABILITY_ID,
        status,
        canClaimOutputQuality,
        createdDocumentCount,
        renderedStageCount,
        observationCount,
        savedDocumentCount,
        outputCount: savedDocumentCount || renderedStageCount,
        warnings
    };
}
