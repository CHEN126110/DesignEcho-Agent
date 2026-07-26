export type DetailPageCreativeStagePlanVersion = 'detail-page-creative-stage-plan/v0';

export interface DetailPageCreativeStagePlanContract {
    version: DetailPageCreativeStagePlanVersion;
    promptSection: string;
}

/**
 * 所有需要阶段化设计的 Skill 共用的最小阶段结构。
 * 任务品类、文档规范名与是否强制使用该契约由 Skill manifest / 调用上下文决定，
 * 本结构不携带详情页、主图或 SKU 的路线判断。
 */
export interface CreativeStage {
    id?: string;
    title?: string;
    purpose?: string;
    sellingPoint?: string;
    imageIntent?: string;
    layoutRoles?: string[];
    observationFocus?: string;
}

export interface CreativeStagePlan {
    targetDocumentName?: string;
    productUnderstanding?: string;
    stages?: CreativeStage[];
    currentStage?: CreativeStage;
}

export interface CreativeStagePlanValidation {
    valid: boolean;
    blockers: string[];
    warnings: string[];
    currentStage?: CreativeStage;
}

const SUPPORTED_LAYOUT_ROLES = new Set([
    'background',
    'main-image',
    'title',
    'subtitle',
    'selling-point',
    'tag',
    'decoration'
]);

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function readObject(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, any>;
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return values
        .map((item) => normalizeText(item))
        .filter(Boolean);
}

function hasPlaceholderText(value: string): boolean {
    return /^(核心卖点|卖点|标题|副标题|点击查看|产品图片|商品图|占位|placeholder)$/i.test(value)
        || /占位/.test(value);
}

function normalizeStage(value: unknown): CreativeStage | undefined {
    const record = readObject(value);
    if (!record) return undefined;
    return {
        id: normalizeText(record.id),
        title: normalizeText(record.title),
        purpose: normalizeText(record.purpose),
        sellingPoint: normalizeText(record.sellingPoint),
        imageIntent: normalizeText(record.imageIntent),
        layoutRoles: cleanStrings(record.layoutRoles),
        observationFocus: normalizeText(record.observationFocus)
    };
}

export function validateCreativeStagePlan(
    value: unknown,
    options: { expectedDocumentName?: string } = {}
): CreativeStagePlanValidation {
    const record = readObject(value);
    const blockers: string[] = [];
    const warnings: string[] = [];
    // 目标文档规范名由调用方按 Skill / 任务上下文传入：
    // - 传入时严格校验 targetDocumentName 与该任务的规范名一致；
    // - 未传入时只要求名称存在且不是占位文本。
    // 通用校验器不推断任务品类，也不写死任何品类名称。
    const expectedDocumentName = normalizeText(options.expectedDocumentName);
    if (!record) {
        return {
            valid: false,
            blockers: [`缺少${expectedDocumentName || '设计'}阶段计划 stagePlan。`],
            warnings: []
        };
    }

    const targetDocumentName = normalizeText(record.targetDocumentName);
    if (expectedDocumentName) {
        if (!targetDocumentName.includes(expectedDocumentName)) {
            blockers.push(`stagePlan.targetDocumentName 必须明确为「${expectedDocumentName}」。`);
        }
    } else if (!targetDocumentName || hasPlaceholderText(targetDocumentName)) {
        blockers.push('stagePlan.targetDocumentName 需要写清目标文档名（如「主图」「详情页」），不能为空或占位。');
    }

    const productUnderstanding = normalizeText(record.productUnderstanding);
    if (productUnderstanding.length < 12) {
        blockers.push('stagePlan.productUnderstanding 需要写清产品理解，不能只写品类名。');
    }
    if (hasPlaceholderText(productUnderstanding)) {
        blockers.push('stagePlan.productUnderstanding 不能是占位文本。');
    }

    const currentStage = normalizeStage(record.currentStage)
        || normalizeStage(Array.isArray(record.stages) ? record.stages[0] : undefined);
    if (!currentStage) {
        blockers.push('stagePlan.currentStage 缺失，renderLayout 需要知道当前阶段目标。');
    } else {
        // id 是本屏图层组与草稿替换的锚：没有 id 就不建组、旧草稿无法安全替换，
        // 图层树直接塌成平铺+多版叠加——升级为 blocker（2026-07-06，用户实测详情页图层失管）。
        if (!currentStage.id) {
            blockers.push('currentStage.id 不能为空：它是本屏图层组和草稿替换的锚，用「2-产品首屏」「5-材质特点」这类「序号-屏用途」结构化命名（序号即阅读顺序）。');
        }
        if (!currentStage.title || hasPlaceholderText(currentStage.title)) {
            blockers.push('currentStage.title 需要是真实阶段标题，不能是占位标题。');
        }
        if (!currentStage.purpose || currentStage.purpose.length < 10) {
            blockers.push('currentStage.purpose 需要说明这一阶段为什么要先做。');
        }
        if (!currentStage.sellingPoint || hasPlaceholderText(currentStage.sellingPoint)) {
            blockers.push('currentStage.sellingPoint 需要写清当前阶段真实卖点。');
        }
        if (!currentStage.imageIntent || currentStage.imageIntent.length < 8) {
            blockers.push('currentStage.imageIntent 需要说明本阶段要使用哪类真实图片。');
        }
        if (!currentStage.observationFocus || currentStage.observationFocus.length < 8) {
            blockers.push('currentStage.observationFocus 需要说明做完后要观察什么。');
        }

        const roles = cleanStrings(currentStage.layoutRoles);
        if (roles.length < 3) {
            blockers.push('currentStage.layoutRoles 至少需要 3 个 renderLayout 角色。');
        }
        const unsupportedRoles = roles.filter((role) => !SUPPORTED_LAYOUT_ROLES.has(role));
        if (unsupportedRoles.length) {
            blockers.push(`currentStage.layoutRoles 包含不支持的角色：${unsupportedRoles.join('、')}。`);
        }
    }

    return {
        valid: blockers.length === 0,
        blockers,
        warnings,
        currentStage
    };
}

export function buildDetailPageCreativeStagePlanPromptSection(): string {
    return [
        '【详情页阶段计划·Agent 决策层】',
        '这是设计师 Agent 在调用 renderLayout 前形成的阶段方案，不是模板脚本，也不是工具执行结果。',
        '规划分两层，骨架先行、逐屏细化——不要提前替没做到的屏编内容：',
        '· 开局只规划屏序骨架：几屏、每屏一行（屏用途 + 解决用户什么疑问），依据是产品理解与详情页方法论的说服逻辑。骨架保持简短，不写各屏的具体文案与选图。',
        '· 当前屏的完整细节（卖点文案、选图、版式角色、观察重点）在做到该屏时再定——那时先分析该屏要用的真实素材，再写 currentStage。',
        '来源约束：产品理解与每屏卖点必须来自带来源和确认等级的项目事实、当前素材 sellingPointObservations 或明确市场洞察。旧 productFacts/sellingPoints 字符串和 Agent 新提案都只能作为待确认候选；信息不足就先分析素材或请求用户确认，不允许用「舒适透气」类万金油词编造。',
        '卖点表现形式：市场洞察的痛点条目自带视觉表现建议（如「勒痕对比图」「弹力示意图」），可再拿表现关键词去 searchEagleReferences 找同类表现的参考案例，学表现手法不照抄成品。',
        '调用 renderLayout 时必须携带 stagePlan 对象：targetDocumentName、productUnderstanding、currentStage.id/title/purpose/sellingPoint/imageIntent/layoutRoles/observationFocus。',
        '屏序骨架必须从项目素材、用户目标、详情页方法论和参考知识中推导；不要使用固定品类清单，也不要把某个袜子项目的模块顺序写成通用流程。',
        'renderLayout 只执行当前阶段草稿：blocks 里的 title / subtitle / selling-point / tag / main-image / background 必须来自当前阶段计划和真实项目上下文。',
        '观察后必须把结果回灌到下一步决策：继续下一阶段、调整当前阶段、重做当前阶段，或说明当前还只是待复核草稿。',
        '文档边界：详情页目标文档名就是「详情页」；当前打开的 SKU 或主图文档不能作为详情页画布。',
        '图层管理即交付物：currentStage.id 用「2-产品首屏」「5-材质特点」这类「序号-屏用途」结构化命名（序号即阅读顺序），引擎按「id·标题」为本屏建组，并在屏组内自动按 文案/图标/图片 三子组归类图层；blocks/regions 的每块都要给业务命名 id（如「卖点-透气」），不要留 role-N 技术名。',
        '逐屏推进必须给 screenRegion（本屏在整页文档中的像素区间 y/height）：不给的话每屏都会从文档顶部排版互相覆盖。重做只影响当前 stageId 的屏组，已完成屏不会被清除。'
    ].join('\n');
}

export function buildDetailPageCreativeStagePlanContract(): DetailPageCreativeStagePlanContract {
    return {
        version: 'detail-page-creative-stage-plan/v0',
        promptSection: buildDetailPageCreativeStagePlanPromptSection()
    };
}

export function hasDetailPageCreativeStagePlanSignal(value: unknown): boolean {
    const text = normalizeText(value);
    if (!text) return false;
    return /阶段计划/.test(text)
        && /当前阶段/.test(text)
        && /renderLayout/.test(text)
        && /(观察|复核|看真实画面)/.test(text);
}
