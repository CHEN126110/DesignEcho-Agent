/**
 * 设计任务类型（data-driven design task types）
 *
 * 目标：把「详情页 = 6-8 屏默认结构 + 这几个阻塞问题 + 这几个素材入口」这类
 * 任务类型知识做成数据，而不是硬编码进 Agent。自主设计循环在识别到某个设计
 * 任务类型后，按本数据生成「先声明任务类型 → 检查上下文 → 只问阻塞问题 →
 * 出结构预览 → 用户确认 → 才落地 Photoshop」的工作指导。
 *
 * 新增一个品类（海报 / 小红书封面 / Banner …）= 在 TASK_TYPE_REGISTRY 里加一条数据，
 * 不需要改 Agent 代码。这是「技能知识数据化、不渗透进 Agent」的落地基座。
 *
 * 纯逻辑、无 Photoshop / 无 renderer 依赖，可被 smoke 直接加载验证。
 */

import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import type { DesignDocumentRole } from './design-document-role';

export type DesignTaskTypeVersion = 'design-task-types/v0';

/** 默认结构里的一屏 / 一个版面单元 */
export interface DesignTaskTypeStructureItem {
    /** 稳定 id，例如 detail-01-kv */
    id: string;
    /** 屏 / 单元标题，例如「首屏 KV」 */
    title: string;
    /** 这一屏要解决什么，例如「第一眼建立产品认知与点击理由」 */
    purpose: string;
}

/** 开工前需要确认的一个问题（只问真正阻塞的） */
export interface DesignTaskTypeIntakeQuestion {
    /** 字段 key，例如 product / asset_source / platform_size */
    key: string;
    /** 问题文案 */
    question: string;
    /** 缺省处理：未提供时如何默认，例如「未指定则按 750px 宽电商详情页处理」 */
    defaultNote?: string;
    /**
     * 是否属于「没有就无法推进」的阻塞问题。
     * 非阻塞问题用 defaultNote 自动填入默认假设，不打断用户。
     */
    blocking: boolean;
}

/** 素材来源入口（界面上呈现为按钮） */
export interface DesignTaskTypeEntryOption {
    key: string;
    label: string;
}

export interface DesignTaskTypeSpec {
    /** 任务类型 id，例如 ecommerce.detail_page.v1 */
    id: string;
    /** 中文标签，例如「电商详情页」 */
    label: string;
    /**
     * 该任务类型对应的业务技能 id（提供该类型的生产/方法论知识）。
     * 自主循环把它当作知识来源，不强制走该技能的结构化执行器。
     */
    skillId?: string;
    /**
     * 任务身份对应的运行提示。它只帮助通用 Harness 选择预算与文档规范化，
     * 不承载 Skill 的方法论、工作流或工具白名单。
     */
    runtimeHints: {
        scenario: DesignAgentOsScenario;
        documentRole: DesignDocumentRole;
    };
    /** 命中该任务类型的正向关键词 */
    matchSignals: string[];
    /**
     * 负向关键词：命中即排除（这些是「检查现成模板 / 模板填充 / 导出 / 保存」
     * 等非「从零设计」语义，应由对应技能的结构化路径处理，不进本任务类型的设计流程）。
     */
    excludeSignals: string[];
    /** 默认画布宽度（电商常见尺寸），用作未指定时的合理默认 */
    defaultCanvasWidth: number;
    /** 默认结构（起点，需按产品与素材调整，不是死模板） */
    defaultStructure: DesignTaskTypeStructureItem[];
    /** 开工前需要确认的问题（阻塞的才问，非阻塞的使用默认值） */
    intakeQuestions: DesignTaskTypeIntakeQuestion[];
    /** 素材来源入口 */
    entryOptions: DesignTaskTypeEntryOption[];
    /**
     * 该品类的目标文档规范名（如「详情页」）。用于 createDocument 结果一致性校验
     * 与阶段计划 targetDocumentName 期望。无则不做文档名校验（多数品类可不设）。
     */
    canonicalDocumentName?: string;
    /**
     * 该品类的 renderLayout 是否必须携带阶段计划 stagePlan。
     * 仅有阶段计划契约的品类（如详情页从零设计）启用；默认 false。
     */
    requiresStagePlanOnRender?: boolean;
    /**
     * 新建画布前是否必须先读取参考输入（searchEagleReferences / searchDesignKnowledge /
     * analyzeAssetContent 分析用户或项目内参考图 / 用户消息自带参考来源）。
     * 用于禁止凭空设计的品类（如 SKU 模板：设计必须有参考）；默认 false。
     * 门禁在 design-discipline-runtime 执行点强制，只检查参考输入是否存在，不限定获取路径。
     */
    requiresReferenceInputBeforeDocument?: boolean;
}

/** 已知上下文：用于过滤「已经知道的就不再问」 */
export interface DesignTaskKnownContext {
    hasPhotoshopDocument?: boolean;
    hasProjectAssets?: boolean;
    hasEagle?: boolean;
}

const DETAIL_PAGE_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: 'ecommerce.detail_page.v1',
    label: '电商详情页',
    skillId: 'detail-page-design',
    runtimeHints: {
        scenario: 'detail-page',
        documentRole: 'detailPage'
    },
    matchSignals: ['详情页', '详情长图', '商品详情', '产品详情', '卖点页', '面料页', '参数页', 'detail page'],
    excludeSignals: [
        '看一下', '看看', '检查', '结构', '分析', '复核',
        '模板填充', '填充', '套版', '换图',
        '导出当前', '当前文档导出', '保存', '另存'
    ],
    defaultCanvasWidth: 750,
    defaultStructure: [
        { id: 'detail-01-kv', title: '首屏 KV', purpose: '第一眼建立产品认知与点击理由' },
        { id: 'detail-02-core-selling', title: '核心卖点', purpose: '一句话讲清最能促成转化的核心卖点' },
        { id: 'detail-03-pain-point', title: '用户痛点解决', purpose: '回应目标用户最关心的疑虑' },
        { id: 'detail-04-material', title: '面料 / 材质', purpose: '用细节画面说明材质卖点' },
        { id: 'detail-05-detail', title: '产品细节', purpose: '放大关键工艺与结构细节' },
        { id: 'detail-06-color-style', title: '颜色 / 款式', purpose: '展示可选颜色与款式，辅助选择' },
        { id: 'detail-07-spec', title: '参数 / 使用说明', purpose: '给出规格、尺码与使用说明' },
        { id: 'detail-08-brand', title: '品牌 / 服务背书', purpose: '用品牌与售后服务建立信任' }
    ],
    intakeQuestions: [
        { key: 'product', question: '产品是什么？', blocking: true },
        {
            key: 'asset_source',
            question: '素材从哪里获取？（当前 Photoshop 文档 / 从 Eagle 选择 / 本地上传）',
            blocking: true
        },
        {
            key: 'platform_size',
            question: '使用哪个平台尺寸？',
            defaultNote: '未指定则按 750px 宽电商详情页处理',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'eagle', label: '从 Eagle 选择素材' },
        { key: 'upload', label: '上传产品资料' }
    ],
    canonicalDocumentName: '详情页',
    requiresStagePlanOnRender: true
};

const MAIN_IMAGE_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: 'ecommerce.main_image.v1',
    label: '电商主图',
    skillId: 'main-image-design',
    runtimeHints: {
        scenario: 'main-image',
        documentRole: 'mainImage'
    },
    matchSignals: ['主图', '首图', '主视觉', '点击图', 'main image'],
    excludeSignals: ['白底图', '自底图', '白底', 'sku', '模板填充', '看一下', '检查', '结构', '保存', '导出当前'],
    defaultCanvasWidth: 800,
    defaultStructure: [
        { id: 'main-01-hero', title: '主视觉首图', purpose: '突出产品主体与核心点击理由' },
        { id: 'main-02-selling', title: '卖点图', purpose: '用一个最强卖点强化点击动机' },
        { id: 'main-03-scene', title: '场景图', purpose: '建立使用场景与代入感' },
        { id: 'main-04-detail', title: '细节图', purpose: '展示关键细节或材质' },
        { id: 'main-05-compare', title: '对比 / 参数图', purpose: '用对比或参数减少购买疑虑' }
    ],
    intakeQuestions: [
        { key: 'product', question: '产品是什么？', blocking: true },
        {
            key: 'asset_source',
            question: '素材从哪里获取？（当前 Photoshop 文档 / 从 Eagle 选择 / 本地上传）',
            blocking: true
        },
        {
            key: 'platform_size',
            question: '使用哪个平台尺寸？',
            defaultNote: '未指定则按 800px 正方形电商主图处理',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'eagle', label: '从 Eagle 选择素材' },
        { key: 'upload', label: '上传产品资料' }
    ]
};

/** SKU 模板设计任务类型 id（单一来源：移交契约 / 控制面信号映射 / 纪律激活共用，勿散落字面量）。 */
export const SKU_TEMPLATE_DESIGN_TASK_TYPE_ID = 'ecommerce.sku_template.v1';

/** SKU 色卡设计任务类型 id；与 v5 sku-color-card Manifest.task_type 保持一致。 */
export const SKU_COLOR_CARD_DESIGN_TASK_TYPE_ID = 'ecommerce.sku_color_card.v1';

const SKU_COLOR_CARD_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: SKU_COLOR_CARD_DESIGN_TASK_TYPE_ID,
    label: 'SKU 色卡',
    skillId: 'sku-color-card',
    runtimeHints: {
        scenario: 'sku',
        documentRole: 'sku'
    },
    matchSignals: ['sku色卡', 'sku 色卡', 'sku颜色卡', 'sku 颜色卡', '色卡源文档'],
    excludeSignals: ['模板', '模版', '组合图', '批量导出', '自选备注', '只说明', '只讨论', '怎么做', '如何做'],
    defaultCanvasWidth: 1500,
    defaultStructure: [
        { id: 'sku-card-product', title: '商品图', purpose: '清楚展示当前颜色对应的商品主体' },
        { id: 'sku-card-label', title: '色名标签', purpose: '使用来源文件名标注颜色，并保持可编辑' },
        { id: 'sku-card-order', title: '参考序号', purpose: '只辅助查看编排顺序，不进入正式颜色资产组' }
    ],
    intakeQuestions: [
        { key: 'color_card_sources', question: '需要使用哪些颜色图片，顺序是什么？', blocking: true },
        {
            key: 'canvas_size',
            question: '色卡画布尺寸是多少？',
            defaultNote: '未指定则按 1500×1500 处理',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-project', label: '使用当前项目同名图片' },
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'upload', label: '上传颜色图片' }
    ],
    canonicalDocumentName: 'SKU'
};

const SKU_TEMPLATE_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
    label: 'SKU 模板',
    skillId: 'sku-config',
    runtimeHints: {
        scenario: 'sku',
        documentRole: 'sku'
    },
    matchSignals: ['sku模板', 'sku 模板', 'sku模版', 'sku 模版', '设计sku', 'sku卡片', 'sku template'],
    // 批量出图 / 看检查 / 导出 等属于 SKU 批量生产或只读路径，不进「从零设计 SKU 模板」流程
    excludeSignals: ['批量', '出图', '看一下', '看看', '检查', '导出当前', '保存', '填充'],
    defaultCanvasWidth: 800,
    defaultStructure: [
        { id: 'sku-01-product', title: '产品 / 色卡区', purpose: '展示产品主体或各颜色色卡' },
        { id: 'sku-02-combo', title: '组合区', purpose: '按规格展示 SKU 颜色 / 款式组合' },
        { id: 'sku-03-name', title: '颜色 / 款式名', purpose: '标注每个组合的颜色或款式名称' },
        { id: 'sku-04-number', title: '编号', purpose: '给每个组合编号 / 序号，便于下单对应' },
        { id: 'sku-05-note', title: '自选备注区', purpose: '放置自选备注说明文案' },
        { id: 'sku-06-export', title: '导出槽位', purpose: '导出切片定位（占位区域不参与最终导出）' }
    ],
    intakeQuestions: [
        { key: 'product', question: '这是什么品类的产品？（袜子 / 服装 / 其他）', blocking: true },
        {
            key: 'template_usage',
            question: '模板用途是什么？（SKU 组合图 / 白底图 / 详情页规格展示）',
            blocking: true
        },
        {
            key: 'asset_source',
            question: '素材从哪里获取？',
            defaultNote: '优先检查项目里现有的 SKU.psb / 色卡素材，找不到再问',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'eagle', label: '从 Eagle 选择素材' },
        { key: 'upload', label: '上传产品资料' }
    ],
    // SKU 模板设计必须有参考（用户预期：不许凭空设计）——建画布前至少读取一项参考输入
    requiresReferenceInputBeforeDocument: true
};

/** 设计任务类型注册表（新增具体品类只需在此加数据） */
export const DESIGN_TASK_TYPE_REGISTRY: readonly DesignTaskTypeSpec[] = Object.freeze([
    DETAIL_PAGE_DESIGN_TASK_TYPE,
    MAIN_IMAGE_DESIGN_TASK_TYPE,
    SKU_COLOR_CARD_DESIGN_TASK_TYPE,
    SKU_TEMPLATE_DESIGN_TASK_TYPE
]);

/**
 * 通用设计兜底类型——**不进 DESIGN_TASK_TYPE_REGISTRY、不被关键词匹配**（matchSignals 为空，
 * 故 resolveDesignTaskTypeSpec 永远不会返回它；非设计文本仍判 undefined 的语义不变）。
 *
 * 仅作为 resolveDesignDisciplineContext 的兜底：当确定是创意设计意图（isCreativeDesignIntent，
 * 来自控制面而非关键词）但不匹配任何具体品类时启用，让海报 / 小红书 / Banner / 任意新设计也继承
 * 通用设计纪律（读方法论 → 建画布 → 排版 → 改后必看 → 质量裁决 → 已学记忆注入），但**不套**任何
 * 品类专属结构 / 阶段计划 / 文档名校验（无 canonicalDocumentName、无 requiresStagePlanOnRender、
 * 只用通用核心工具集）。这是"扩品类覆盖面"的正解：靠通用兜底而非逐品类堆关键词（理解优于硬编码）。
 */
export const GENERIC_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: 'design.generic.v1',
    label: '通用设计',
    runtimeHints: {
        scenario: 'general-design',
        documentRole: 'unknown'
    },
    matchSignals: [],
    excludeSignals: [],
    defaultCanvasWidth: 1080,
    defaultStructure: [],
    intakeQuestions: [
        { key: 'goal', question: '这个设计要达成什么目标、用在什么场景？', blocking: true },
        {
            key: 'asset_source',
            question: '素材从哪里获取？（当前 Photoshop 文档 / 从 Eagle 选择 / 本地上传）',
            blocking: true
        },
        {
            key: 'canvas_size',
            question: '成图尺寸是多少？',
            defaultNote: '未指定则按 1080px 通用画布处理',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'eagle', label: '从 Eagle 选择素材' },
        { key: 'upload', label: '上传素材' }
    ]
};

/**
 * 可由结构化控制面声明的任务类型。
 *
 * 通用设计只加入声明目录，不加入文本匹配注册表：模型可在 R0 明确声明它，
 * 但本地 Harness 不会因为“海报 / Banner”等关键词替模型推断通用设计意图。
 */
const DECLARABLE_DESIGN_TASK_TYPE_SPECS: readonly DesignTaskTypeSpec[] = Object.freeze([
    ...DESIGN_TASK_TYPE_REGISTRY,
    GENERIC_DESIGN_TASK_TYPE
]);

function normalizeTaskText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function textIncludesAny(text: string, signals: string[]): boolean {
    return signals.some((signal) => signal && text.includes(signal.toLowerCase()));
}

export function getDesignTaskTypeSpec(id?: string): DesignTaskTypeSpec | undefined {
    if (!id) return undefined;
    return DECLARABLE_DESIGN_TASK_TYPE_SPECS.find((spec) => spec.id === id);
}

/**
 * 通过现有 Skill 声明入口查找任务类型。仅用于兼容 v3 的结构化 skillId 提示；
 * 完整 Skill 能力解析最终由 v5 manifest / Capability resolver 负责。
 */
export function getDesignTaskTypeSpecBySkillId(skillId?: string): DesignTaskTypeSpec | undefined {
    const normalized = String(skillId || '').trim();
    if (!normalized) return undefined;
    return DESIGN_TASK_TYPE_REGISTRY.find((spec) => spec.skillId === normalized);
}

/**
 * 已注册的合法设计任务类型 id 枚举（结构化数据，非对用户措辞做关键词匹配）。
 *
 * 用途（V2「意图交给 Agent 理解」）：让模型能**准确声明**本轮 task_type——把这份合法 id 目录注入
 * 声明工具的 description / 校验失败信息，模型据此声明、拼错即安全降级为不激活（getDesignTaskTypeSpec
 * 对未注册 id 返回 undefined）。通用设计在这里是可声明身份，但仍不进入文本匹配注册表；
 * 具体品类则必须先进入 DESIGN_TASK_TYPE_REGISTRY 才能被声明和匹配。
 */
export function listDesignTaskTypeIds(): string[] {
    return DECLARABLE_DESIGN_TASK_TYPE_SPECS.map((spec) => spec.id);
}

/** 判定一个 id 是否为已注册的合法设计任务类型（供 design-intent-signal 等做纵深校验，不引入模块环依赖）。 */
export function isRegisteredDesignTaskTypeId(id?: unknown): boolean {
    return typeof id === 'string' && DECLARABLE_DESIGN_TASK_TYPE_SPECS.some((spec) => spec.id === id);
}

/**
 * 控制面结构化信号 → 设计任务类型 id 的数据映射（声明式纪律激活通道，评审修复 2026-07-03）。
 *
 * 背景：部分品类在控制面有专属信号（如「设计 SKU 模板」发 sku_template_design_autonomy，
 * 不发 explicit_creative_design），导致纪律上下文的 isCreativeDesignIntent 恒为 false、
 * 参考先行门禁在真实入口不可达。本映射把已结构化的控制面信号翻译成 declaredTaskTypeId，
 * 供 resolveDesignDisciplineContext 确定性激活——数据驱动，不是对用户文本做新的关键词匹配。
 * 新品类若有专属控制面信号，在此加一条数据即可。
 */
export const CONTROL_PLANE_SIGNAL_TASK_TYPE_MAP: Readonly<Record<string, string>> = Object.freeze({
    sku_template_design_autonomy: SKU_TEMPLATE_DESIGN_TASK_TYPE_ID
});

/** 从控制面 matchedSignals 解析声明式任务类型 id；无命中返回 undefined（不做文本猜测）。 */
export function resolveDeclaredDesignTaskTypeIdFromControlPlaneSignals(
    signals: unknown
): string | undefined {
    if (!Array.isArray(signals)) return undefined;
    for (const signal of signals) {
        const mapped = CONTROL_PLANE_SIGNAL_TASK_TYPE_MAP[String(signal || '').trim()];
        if (mapped) return mapped;
    }
    return undefined;
}

/**
 * 从用户文本解析设计任务类型。
 * 命中正向关键词且不命中负向关键词时返回对应 spec；否则返回 undefined
 * （非设计任务、或属于「检查现成模板 / 填充 / 导出」等结构化路径）。
 */
export function resolveDesignTaskTypeSpec(text: unknown): DesignTaskTypeSpec | undefined {
    const normalized = normalizeTaskText(text);
    if (!normalized) return undefined;
    for (const spec of DESIGN_TASK_TYPE_REGISTRY) {
        if (textIncludesAny(normalized, spec.excludeSignals)) continue;
        if (textIncludesAny(normalized, spec.matchSignals)) return spec;
    }
    return undefined;
}

/**
 * 文本是否命中任一已注册品类的负向信号（检查 / 填充 / 套版 / 换图 / 导出 / 保存 / 批量出图 等
 * "非从零设计"的只读 / 维护语义）。
 * 通用设计兜底（GENERIC_DESIGN_TASK_TYPE）用它做安全网：即便控制面判为创意意图，命中这些信号也
 * 不进从零设计纪律——这些属只读 / 模板填充 / 导出路径，应由对应结构化路径处理。
 */
export function hitsAnyDesignTaskExcludeSignal(text: unknown): boolean {
    const normalized = normalizeTaskText(text);
    if (!normalized) return false;
    return DESIGN_TASK_TYPE_REGISTRY.some((spec) => textIncludesAny(normalized, spec.excludeSignals));
}

/** 过滤掉「已知上下文已能回答」的阻塞问题，避免重复追问 */
function filterBlockingQuestions(
    spec: DesignTaskTypeSpec,
    known: DesignTaskKnownContext
): DesignTaskTypeIntakeQuestion[] {
    return spec.intakeQuestions.filter((question) => {
        if (!question.blocking) return false;
        if (question.key === 'asset_source' && (known.hasPhotoshopDocument || known.hasProjectAssets || known.hasEagle)) {
            // 已经有可用素材来源，则素材来源不再是阻塞问题
            return false;
        }
        return true;
    });
}

/** 结构化 intake（供界面渲染入口卡片 / 结构预览使用） */
export interface DesignTaskTypeIntake {
    version: DesignTaskTypeVersion;
    taskTypeId: string;
    label: string;
    skillId?: string;
    blockingQuestions: DesignTaskTypeIntakeQuestion[];
    deferredQuestions: DesignTaskTypeIntakeQuestion[];
    defaultStructure: DesignTaskTypeStructureItem[];
    entryOptions: DesignTaskTypeEntryOption[];
}

export function buildDesignTaskTypeIntake(
    spec: DesignTaskTypeSpec,
    known: DesignTaskKnownContext = {}
): DesignTaskTypeIntake {
    const blockingQuestions = filterBlockingQuestions(spec, known);
    const deferredQuestions = spec.intakeQuestions.filter(
        (question) => !blockingQuestions.includes(question)
    );
    return {
        version: 'design-task-types/v0',
        taskTypeId: spec.id,
        label: spec.label,
        skillId: spec.skillId,
        blockingQuestions,
        deferredQuestions,
        defaultStructure: spec.defaultStructure,
        entryOptions: spec.entryOptions
    };
}

/**
 * 生成注入自主设计循环系统提示词的数据驱动指导段。
 * 让主 Agent 按「声明任务类型 → 检查上下文 → 只问阻塞问题 → 出结构预览 →
 * 用户确认 → 才落地 Photoshop」工作，结构来自数据而非硬编码散文。
 */
export function buildDesignTaskTypePromptSection(
    spec: DesignTaskTypeSpec,
    known: DesignTaskKnownContext = {},
    options: { withoutTools?: boolean } = {}
): string {
    const intake = buildDesignTaskTypeIntake(spec, known);
    const lines: string[] = [];

    lines.push(`【设计任务类型：${spec.label}（${spec.id}）】`);
    lines.push(spec.skillId
        ? `识别到这是「${spec.label}」设计任务。先向用户说明这是一个${spec.label}设计任务，`
            + `将参考 ${spec.skillId} 的方法论知识来设计，但路线由你作为主设计师自主决定。`
        : `识别到这是「${spec.label}」设计任务。它没有绑定专用业务 Skill；请根据目标按需组合通用设计知识、`
            + '原子工具、视觉观察和质量复核能力，自主决定路线。');
    // Harness「agency 归模型」：关键词初判只是假设，不是硬路线。若真实意图是"操作既有文件"而非从零设计，
    // 模型有权直接改道——观察类工具与导出/保存工具已在设计纪律中全程放行，模型能真正执行改道后的动作。
    lines.push(
        `⚠️ 以上是根据关键词的初步判断，不是锁死的路线。如果用户其实是要【导出 / 编辑 / 检查 / 复用现有文件】` +
        `（例如"导出主图详情页""帮我改一下详情页的文案""看看这张详情页做得怎样"），请直接按真实意图推进：` +
        `先打开并读取相关的现有文档看清它是什么，再按需导出、修改或复核——不要被"从零设计"框住，更不要为此新建空白画布。`
    );
    if (options.withoutTools) {
        // 纯对话/思考阶段：没有工具可调，不要提示模型去"读取"工具，否则会把工具调用吐成文本。
        lines.push('先在心里理清「已知信息」和「缺失信息」（本轮不调用任何工具，只做理解与规划）。');
    } else {
        lines.push(
            '先读取已有上下文（getDesignProjectState、listProjectResources / searchProjectResources、' +
            '当前 Photoshop 文档、searchEagleReferences），判断哪些信息已知、哪些缺失。'
        );
    }

    if (intake.blockingQuestions.length) {
        const questionText = intake.blockingQuestions
            .map((question, index) => `${index + 1}. ${question.question}`)
            .join('\n');
        lines.push(
            `只问真正阻塞的问题（最多 ${intake.blockingQuestions.length} 个），其余用合理默认值，不要一上来问一长串：\n${questionText}`
        );
    } else {
        lines.push('已有可用上下文时不要重复追问，直接用已知信息和合理默认值推进。');
    }

    const deferredWithDefault = intake.deferredQuestions.filter((question) => question.defaultNote);
    if (deferredWithDefault.length) {
        const defaultsText = deferredWithDefault
            .map((question) => `- ${question.question} ${question.defaultNote}`)
            .join('\n');
        lines.push(`以下信息缺失时使用默认值，不必打断用户：\n${defaultsText}`);
    }

    const structureText = intake.defaultStructure
        .map((item, index) => `${String(index + 1).padStart(2, '0')} ${item.title}——${item.purpose}`)
        .join('\n');
    lines.push(
        `默认结构（起点，可根据产品和素材调整，不是死模板，禁止照搬到不匹配的产品）：\n${structureText}`
    );

    const entryText = intake.entryOptions.map((option) => `[${option.label}]`).join('  ');
    lines.push(`素材来源可向用户提供这几个入口：${entryText}。`);

    lines.push(
        '在落地 Photoshop 之前，先生成结构预览（storyboard）并由 Agent 对照 Brief、素材与视觉观察自检；此阶段只规划，不修改 Photoshop 文档，也不直接生成完整 PSD。' +
        '用户未要求逐步确认、品牌方向没有关键缺口且操作可逆时，直接在沙盒文档中按阶段落地、每步观察真实结果；只有缺少会改变方案的用户决策或存在不可逆风险时才暂停确认。'
    );

    return lines.join('\n');
}
