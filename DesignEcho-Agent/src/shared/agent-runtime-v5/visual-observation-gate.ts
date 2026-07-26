/**
 * v5 视觉观察门禁（P0 热修核心纯逻辑 / R2 Context Intelligence 的入口约束）
 *
 * 背景与根因（已核实）：详情页规划链路此前只向模型注入文件名/目录名/元数据，视觉观察
 * 从未进入规划。模型据此"瞎猜"产品（把白色过膝长袜猜成汉服并硬编 8 屏 storyboard）。
 * 这不是 prompt 或模型质量问题，而是"真实视觉观察根本没进规划链路"。
 *
 * 本模块按架构决策实现**确定性门禁**：没有可靠视觉观察时，不允许进入完整详情页规划，
 * 从机制上杜绝据文件名编造产品事实。它只做判定，不做分析。
 *
 * 不可放宽的边界：
 * - 现有 visualInsightCache 缺 provenance（fileSha256 / promptVersion / analysisSchemaVersion /
 *   capabilityStatus），一律视为 legacy_unverified：不能通过门禁、不能被补字段静默升级。
 * - 可放行的视觉观察（verified_visual / cached_visual_valid）只能由带 provenance 的真实视觉分析
 *   产出，不能由 Renderer 临时拼造。
 * - 本模块是纯逻辑：不调模型、不读像素、不写缓存、不触发 IPC、不依赖运行环境。
 */

import {
    isSha256Ref,
    type VisualObservation,
    type VisualObservationProvenance
} from './visual-observation';

export type { VisualObservationProvenance };

/** 视觉观察等级（从强到弱）。前两级可进入完整规划，user_confirmed 仅限有限降级，其余阻断。 */
export type VisualObservationLevel =
    | 'verified_visual' //  本次真实视觉分析产生（带 provenance）
    | 'cached_visual_valid' //  命中可信缓存：文件哈希 / 模型 / prompt / schema 版本全部匹配
    | 'user_confirmed' //  用户明确确认产品事实，仅允许结构草案
    | 'legacy_unverified' //  有旧视觉缓存但缺 provenance，不可信
    | 'metadata_only' //  仅有结构化元数据（尺寸 / 类型 / 文件夹）
    | 'filename_only' //  仅有文件名 / 路径
    | 'missing'; //  没有任何可用视觉输入

/** 规划模式：完整规划 / 仅结构草案 / 阻断。 */
export type PlanningMode = 'full' | 'structure_only' | 'blocked';

/** 门禁阻断时给用户的恢复动作（对应 P0 的三个按钮 + 结构草案选项）。 */
export type VisualObservationRecoveryAction =
    | 'RUN_PROJECT_VISUAL_ANALYSIS' //  分析项目图片（走 Main 侧视觉服务）
    | 'SELECT_PRODUCT_IMAGES' //  用户指定代表图片再分析
    | 'CONFIRM_PRODUCT_CATEGORY' //  用户手动确认产品 → 进入 structure_only
    | 'CONTINUE_AS_STRUCTURE_ONLY'; //  明确仅要结构草案

/** 视觉观察缺失阻断器（不新增顶级生命周期状态，作为 context_analysis 阶段的 blocker）。 */
export interface VisualObservationBlocker {
    code: 'VISUAL_OBSERVATION_REQUIRED';
    severity: 'blocking';
    owner: 'R2';
    message: string;
    recoveryActions: VisualObservationRecoveryAction[];
}

/** structure_only 模式下的内容范围：可排版骨架，但不能编造产品事实。 */
export interface StructureOnlyConstraints {
    capabilityStatus: 'fallback';
    /** 是否允许写入视觉性产品宣称（材质 / 长度 / 颜色 / 功效等）。structure_only 下恒为 false。 */
    visualClaimsAllowed: false;
    /** 是否允许据未验证观察下产品事实结论。structure_only 下恒为 false。 */
    productClaimsAllowed: false;
    /** 是否纳入质量门禁评分。structure_only 下恒为 false（未验证不参与质量判定）。 */
    qualityGateEligible: false;
}

export const STRUCTURE_ONLY_CONSTRAINTS: StructureOnlyConstraints = Object.freeze({
    capabilityStatus: 'fallback',
    visualClaimsAllowed: false,
    productClaimsAllowed: false,
    qualityGateEligible: false
});

/** 门禁输入：宽松鸭子类型，便于 Renderer / Main / smoke 共用，不强绑既有缓存类型。 */
export interface VisualObservationGateInput {
    /** 既有视觉洞察缓存的只读视图（entries 可能带或不带 provenance）。 */
    visualInsightCache?: {
        entries?: Array<{
            insight?: {
                assetId?: string;
                observations?: VisualObservation[];
                provenance?: VisualObservationProvenance | null;
            } | null;
            provenance?: VisualObservationProvenance | null;
        } | null | undefined>;
    } | null;
    /** 是否本次刚完成真实视觉分析（用于区分 verified_visual 与 cached_visual_valid）。 */
    freshAnalysis?: boolean;
    /**
     * 当前素材集真实指纹（sha256:<64hex>，由系统从文件内容计算）。门禁据此与每条可信缓存项的
     * provenance.assetSetHash 比对，判断缓存是否仍匹配当前素材集——**不接受调用方传入"是否匹配"
     * 的布尔，杜绝伪造**。未提供（或格式非法）时，任何可信项都因无法确认匹配而不予采信。
     */
    currentAssetSetHash?: string;
    /** 是否存在结构化资产元数据（尺寸 / 类型 / 文件夹角色等）。 */
    hasAssetMetadata?: boolean;
    /** 是否存在文件名 / 路径线索。 */
    hasFilenames?: boolean;
    /** 用户是否已明确确认产品事实（人工背书）。P0 阶段不创建该状态（留待 Main Fact Ledger）。 */
    userConfirmedProduct?: boolean;
    /**
     * 用户主动选择的降级模式。P0 默认 none；用户在 blocked 下点"查看结构草案"才传 'structure_only'。
     * 这是 structure_only 的**唯一**触发入口——观察等级不会自动把任何项目带入 structure_only。
     */
    fallbackMode?: StructureFallbackMode;
}

/** 门禁判定结果。 */
export interface VisualObservationGateDecision {
    level: VisualObservationLevel;
    planningMode: PlanningMode;
    /** 阻断时给出 blocker；非阻断为 undefined。 */
    blocker?: VisualObservationBlocker;
    /** structure_only 时给出能力限制；其余为 undefined。 */
    constraints?: StructureOnlyConstraints;
}

/** 一条缓存项的最小读取形状（可能带或不带 provenance）。 */
type VisualObservationCacheEntryLike = {
    insight?: {
        assetId?: string;
        observations?: VisualObservation[];
        provenance?: VisualObservationProvenance | null;
    } | null;
    provenance?: VisualObservationProvenance | null;
} | null | undefined;

/** 取一条缓存项的 provenance（兼容 insight.provenance 与顶层 provenance）。 */
function provenanceOf(entry: VisualObservationCacheEntryLike): VisualObservationProvenance | null | undefined {
    if (!entry) return undefined;
    return entry.insight?.provenance || entry.provenance;
}

/**
 * 判断一条缓存项是否带**可信** provenance：fileSha256 / assetSetHash 为精确 sha256:<64hex>，
 * prompt / schema 版本齐全，且 capabilityStatus=real。比"长度≥N"严格，杜绝伪造短哈希。
 */
function hasTrustedProvenance(entry: VisualObservationCacheEntryLike): boolean {
    const p = provenanceOf(entry);
    if (!p) return false;
    return (
        isSha256Ref(p.fileSha256) &&
        isSha256Ref(p.assetSetHash) &&
        typeof p.promptVersion === 'string' && p.promptVersion.trim().length > 0 &&
        typeof p.analysisSchemaVersion === 'string' && p.analysisSchemaVersion.trim().length > 0 &&
        p.capabilityStatus === 'real'
    );
}

/** 来源信息不能替代画面内容；至少要有一条与素材绑定、结构合法的视觉观察。 */
function hasStructuredVisualObservation(entry: VisualObservationCacheEntryLike): boolean {
    const insight = entry?.insight;
    if (!insight || typeof insight.assetId !== 'string' || !insight.assetId.trim()) return false;
    if (!Array.isArray(insight.observations)) return false;
    return insight.observations.some((observation) => (
        Boolean(observation)
        && typeof observation.observationId === 'string'
        && Boolean(observation.observationId.trim())
        && typeof observation.statement === 'string'
        && Boolean(observation.statement.trim())
        && typeof observation.confidence === 'number'
        && Number.isFinite(observation.confidence)
        && observation.confidence >= 0
        && observation.confidence <= 1
        && (observation.observationBasis === 'direct_visual' || observation.observationBasis === 'inferred_visual')
    ));
}

/** 用户主动选择的降级模式。P0 默认 none；仅当用户在 blocked 下点"查看结构草案"才为 structure_only。 */
export type StructureFallbackMode = 'none' | 'structure_only';

/**
 * 由视觉观察等级 + 用户降级选择解析规划模式。门禁硬规则：
 * - verified_visual / cached_visual_valid → full（可完整规划）
 * - 否则：用户主动选了 structure_only → structure_only（确定性骨架，禁产品事实）
 * - 否则 → blocked
 *
 * 关键（按 GPT 决策）：structure_only **不由观察等级自动触发**（含 user_confirmed），
 * 必须用户在 blocked 下主动选择"查看结构草案"；blocked 不会自动变 structure_only。
 */
export function resolvePlanningMode(level: VisualObservationLevel, fallbackMode: StructureFallbackMode = 'none'): PlanningMode {
    if (level === 'verified_visual' || level === 'cached_visual_valid') return 'full';
    if (fallbackMode === 'structure_only') return 'structure_only';
    return 'blocked';
}

/**
 * 解析当前项目的视觉观察等级。判定顺序（强→弱）：
 * 1. 带可信 provenance 的缓存项，且未声明素材集失配 → verified_visual / cached_visual_valid
 * 2. 用户明确确认产品 → user_confirmed
 * 3. 有视觉缓存但全无可信 provenance → legacy_unverified（关键：不因 entriesWithInsight 升级）
 * 4. 有结构化元数据 → metadata_only
 * 5. 仅有文件名 → filename_only
 * 6. 其余 → missing
 */
export function resolveVisualObservationLevel(input: VisualObservationGateInput): VisualObservationLevel {
    const entries = Array.isArray(input.visualInsightCache?.entries)
        ? input.visualInsightCache!.entries!.filter(Boolean)
        : [];
    const trustedEntries = entries.filter((entry) => (
        hasTrustedProvenance(entry) && hasStructuredVisualObservation(entry)
    ));
    //  可信项必须其 provenance.assetSetHash 与"当前素材集真实指纹"一致（系统比对，不信任布尔）。
    //  未提供合法 currentAssetSetHash 时无法确认匹配 → 不采信任何可信项，向下回落。
    const matchedTrusted = isSha256Ref(input.currentAssetSetHash)
        ? trustedEntries.filter((entry) => provenanceOf(entry)?.assetSetHash === input.currentAssetSetHash)
        : [];

    //  1) 可靠视觉观察：provenance 齐全且素材集指纹匹配当前
    if (matchedTrusted.length > 0) {
        return input.freshAnalysis ? 'verified_visual' : 'cached_visual_valid';
    }

    //  2) 用户人工背书的产品事实
    if (input.userConfirmedProduct) return 'user_confirmed';

    //  3) 有缓存数据但不可信（缺 provenance 或素材集失配）
    if (entries.length > 0) return 'legacy_unverified';

    //  4) 仅结构化元数据
    if (input.hasAssetMetadata) return 'metadata_only';

    //  5) 仅文件名
    if (input.hasFilenames) return 'filename_only';

    return 'missing';
}

/** 构造"需要视觉观察"阻断器，文案与恢复动作面向用户。 */
export function buildVisualObservationRequiredBlocker(): VisualObservationBlocker {
    return {
        code: 'VISUAL_OBSERVATION_REQUIRED',
        severity: 'blocking',
        owner: 'R2',
        message: '尚未完成产品图片分析，当前无法可靠生成详情页。我不会仅根据文件名推测产品。',
        recoveryActions: [
            'RUN_PROJECT_VISUAL_ANALYSIS',
            'SELECT_PRODUCT_IMAGES',
            'CONFIRM_PRODUCT_CATEGORY',
            'CONTINUE_AS_STRUCTURE_ONLY'
        ]
    };
}

/**
 * 门禁总入口：从视觉输入解析等级 → 规划模式 → 阻断器 / 能力限制。
 * Renderer 详情页分支据此决定：blocked 不调规划模型；structure_only 调但禁产品事实；full 正常规划。
 */
export function evaluateVisualObservationGate(input: VisualObservationGateInput): VisualObservationGateDecision {
    const level = resolveVisualObservationLevel(input);
    const planningMode = resolvePlanningMode(level, input.fallbackMode);
    return {
        level,
        planningMode,
        blocker: planningMode === 'blocked' ? buildVisualObservationRequiredBlocker() : undefined,
        constraints: planningMode === 'structure_only' ? STRUCTURE_ONLY_CONSTRAINTS : undefined
    };
}
