import type { DesignAgentSourceRef } from './design-agent-os-contracts';
import type {
    ProjectAssetIndex,
    ProjectAssetIndexAsset,
    ProjectAssetIndexVisionCandidate,
    ProjectAssetRole
} from './project-asset-index';

export type ProjectVisualSamplingVersion = 'project-visual-sampling/v0';
export type ProjectVisualSamplingMode = 'bounded-metadata-plan';
export type ProjectVisualSamplingScenario =
    | 'main-image'
    | 'detail-page'
    | 'sku'
    | 'reference-replication'
    | 'general-design'
    | 'unknown';
export type ProjectVisualSamplingCacheStatus = 'hit' | 'miss' | 'stale';

/** 主体（被售卖商品本身）占画面面积档位，来自 analyzeAssetContent 的视觉判断。 */
export type ProjectVisualSubjectCoverageRatio = 'dominant' | 'moderate' | 'small';
/** 主体在画面中的主要位置。 */
export type ProjectVisualSubjectPosition = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'scattered';
/** 是否适合做需要突出该商品的主图。 */
export type ProjectVisualMainImageSuitability = 'suitable' | 'marginal' | 'unsuitable';
/** 素材本质：raw_photo 原始拍摄素材（可用原料）/ finished_design 已完成设计成品（交付物，不当素材）。 */
export type ProjectVisualAssetNature = 'raw_photo' | 'finished_design';

/**
 * analyzeAssetContent 产出的构图理解字段（缓存透传用，全部可选）。
 * 旧缓存条目没有这些字段时必须原样安全通过（undefined），不得报错或臆造。
 */
export interface ProjectVisualInsightCompositionFields {
    assetNature?: ProjectVisualAssetNature;
    visibleText?: string;
    subjectCoverageRatio?: ProjectVisualSubjectCoverageRatio;
    subjectPosition?: ProjectVisualSubjectPosition;
    /** 画面视觉重心实际落在什么上（自由文本，如「袜子/腿部」）。 */
    compositionFocus?: string;
    mainImageSuitability?: ProjectVisualMainImageSuitability;
    mainImageSuitabilityReason?: string;
}

export interface ProjectVisualInsight extends ProjectVisualInsightCompositionFields {
    assetId: string;
    path: string;
    summary?: string;
    productType?: string;
    scene?: string;
    material?: string;
    /** 图中真实可见内容及其能够支持的卖点；只保留短文本，不保存原始视觉载荷。 */
    sellingPointObservations?: string[];
    styleTags?: string[];
    capturedAt?: string;
    modelId?: string;
    expiresAt?: string;
    sourceNotes?: DesignAgentSourceRef[];
}

export interface ProjectVisualSamplingCacheEntry {
    cacheKey: string;
    assetId?: string;
    path?: string;
    updatedAt?: string;
    expiresAt?: string;
    insight?: ProjectVisualInsight;
    sourceRecords?: DesignAgentSourceRef[];
}

export interface ProjectVisualSamplingCandidate {
    assetId: string;
    path: string;
    role: ProjectAssetRole;
    priority: number;
    score: number;
    reason: string;
    cacheKey: string;
    cacheStatus: ProjectVisualSamplingCacheStatus;
    shouldAnalyze: boolean;
    requiredObservations: string[];
    cachedInsight?: ProjectVisualInsight;
    selectionNotes: DesignAgentSourceRef[];
}

export interface ProjectVisualSamplingPlan {
    planVersion: ProjectVisualSamplingVersion;
    mode: ProjectVisualSamplingMode;
    scenario: ProjectVisualSamplingScenario;
    maxCandidates: number;
    selectedCandidates: ProjectVisualSamplingCandidate[];
    skippedCandidateCount: number;
    cacheSummary: {
        hit: number;
        miss: number;
        stale: number;
        shouldAnalyze: number;
    };
    warnings: string[];
    limitations: string[];
    sourceRecords: DesignAgentSourceRef[];
}

export interface BuildProjectVisualSamplingPlanInput {
    assetIndex?: ProjectAssetIndex | null;
    scenario?: ProjectVisualSamplingScenario;
    maxCandidates?: number;
    cachedInsights?: ProjectVisualSamplingCacheEntry[];
    nowIso?: string;
}

export interface ProjectVisualSamplingBudget {
    budgetVersion: 'project-visual-sampling-budget/v0';
    scenario: ProjectVisualSamplingScenario;
    maxCandidates: number;
    hardCap: number;
    source: 'project-visual-sampling';
    limitations: string[];
}

const ROLE_PREFERENCE_BY_SCENARIO: Record<ProjectVisualSamplingScenario, ProjectAssetRole[]> = {
    'main-image': ['raw-model-wear', 'raw-product-still', 'color-single', 'raw-detail-closeup', 'unknown'],
    'detail-page': ['raw-detail-closeup', 'raw-model-wear', 'raw-product-still', 'color-single', 'unknown'],
    sku: ['color-single', 'raw-product-still', 'raw-detail-closeup', 'raw-model-wear', 'unknown'],
    'reference-replication': ['raw-model-wear', 'raw-product-still', 'color-single', 'raw-detail-closeup', 'unknown'],
    'general-design': ['raw-model-wear', 'raw-product-still', 'raw-detail-closeup', 'color-single', 'unknown'],
    unknown: ['raw-model-wear', 'raw-product-still', 'raw-detail-closeup', 'color-single', 'unknown']
};

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeVisualSamplingScenario(value: unknown): ProjectVisualSamplingScenario {
    const scenario = normalizeText(value);
    return Object.prototype.hasOwnProperty.call(ROLE_PREFERENCE_BY_SCENARIO, scenario)
        ? scenario as ProjectVisualSamplingScenario
        : 'general-design';
}

function defaultVisualCandidateCountForScenario(scenario: ProjectVisualSamplingScenario): number {
    switch (scenario) {
        case 'main-image':
            return 4;
        case 'detail-page':
            return 6;
        case 'sku':
        case 'general-design':
            return 4;
        case 'reference-replication':
            return 2;
        default:
            return 3;
    }
}

export function buildProjectVisualSamplingBudget(input: {
    scenario?: unknown;
    requestedMaxCandidates?: unknown;
} = {}): ProjectVisualSamplingBudget {
    const scenario = normalizeVisualSamplingScenario(input.scenario);
    const fallback = defaultVisualCandidateCountForScenario(scenario);
    const requested = Number(input.requestedMaxCandidates);
    const maxCandidates = Number.isFinite(requested)
        ? Math.max(0, Math.min(8, Math.round(requested)))
        : fallback;

    return {
        budgetVersion: 'project-visual-sampling-budget/v0',
        scenario,
        maxCandidates,
        hardCap: 8,
        source: 'project-visual-sampling',
        limitations: [
            '候选预算属于项目素材抽样策略，不代表 Agent 已选择业务路线或已经调用视觉模型。',
            '候选数量只控制进入视觉预检的图片范围，不能声明最佳图片、产品款式或设计质量。'
        ]
    };
}

function normalizePath(value: unknown): string {
    return normalizeText(value).replace(/\\/g, '/');
}

const SUBJECT_COVERAGE_RATIO_VALUES: readonly ProjectVisualSubjectCoverageRatio[] = ['dominant', 'moderate', 'small'];
const SUBJECT_POSITION_VALUES: readonly ProjectVisualSubjectPosition[] = ['center', 'top', 'bottom', 'left', 'right', 'scattered'];
const MAIN_IMAGE_SUITABILITY_VALUES: readonly ProjectVisualMainImageSuitability[] = ['suitable', 'marginal', 'unsuitable'];
const ASSET_NATURE_VALUES: readonly ProjectVisualAssetNature[] = ['raw_photo', 'finished_design'];
const COMPOSITION_FREE_TEXT_MAX_LENGTH = 300;

function normalizeCompositionEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
    const text = normalizeText(value).toLowerCase();
    if (!text) return undefined;
    return (allowed as readonly string[]).includes(text) ? (text as T) : undefined;
}

function normalizeCompositionFreeText(value: unknown): string | undefined {
    const text = normalizeText(value);
    if (!text) return undefined;
    return text.slice(0, COMPOSITION_FREE_TEXT_MAX_LENGTH);
}

/**
 * 归一化 analyzeAssetContent 的构图理解字段：枚举值统一小写并裁剪空白，
 * 非法枚举值置 undefined（不猜测、不伪造）；自由文本裁剪空白并限制长度。
 * 缓存写入（cache-fill 映射、sanitize）与缓存读出（visionSignal 映射）共用本函数，
 * 保证同一字段在整条供给链路上只有一种归一化口径。
 */
export function normalizeProjectVisualInsightCompositionFields(
    source: Record<string, unknown> | null | undefined
): ProjectVisualInsightCompositionFields {
    if (!source || typeof source !== 'object') return {};
    const record = source as Record<string, unknown>;
    const fields: ProjectVisualInsightCompositionFields = {};
    const assetNature = normalizeCompositionEnum(record.assetNature, ASSET_NATURE_VALUES);
    const visibleText = normalizeCompositionFreeText(record.visibleText);
    const subjectCoverageRatio = normalizeCompositionEnum(record.subjectCoverageRatio, SUBJECT_COVERAGE_RATIO_VALUES);
    const subjectPosition = normalizeCompositionEnum(record.subjectPosition, SUBJECT_POSITION_VALUES);
    const compositionFocus = normalizeCompositionFreeText(record.compositionFocus);
    const mainImageSuitability = normalizeCompositionEnum(record.mainImageSuitability, MAIN_IMAGE_SUITABILITY_VALUES);
    const mainImageSuitabilityReason = normalizeCompositionFreeText(record.mainImageSuitabilityReason);
    if (assetNature) fields.assetNature = assetNature;
    if (visibleText) fields.visibleText = visibleText;
    if (subjectCoverageRatio) fields.subjectCoverageRatio = subjectCoverageRatio;
    if (subjectPosition) fields.subjectPosition = subjectPosition;
    if (compositionFocus) fields.compositionFocus = compositionFocus;
    if (mainImageSuitability) fields.mainImageSuitability = mainImageSuitability;
    if (mainImageSuitabilityReason) fields.mainImageSuitabilityReason = mainImageSuitabilityReason;
    return fields;
}

/**
 * 判断一个视觉结果是否真的包含与某张素材绑定的画面理解。
 *
 * assetId/path 只负责绑定素材；summary/modelId/capturedAt 只描述记录本身，均不能单独
 * 代表已经看过图片。只有至少一个结构化画面字段存在时，才算可复用的视觉理解。
 */
export function hasConcreteProjectVisualInsight(value: unknown): value is ProjectVisualInsight {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const isAssetBound = Boolean(normalizeText(record.assetId) || normalizePath(record.path));
    if (!isAssetBound) return false;

    const composition = normalizeProjectVisualInsightCompositionFields(record);
    const hasTextField = [
        record.productType,
        record.scene,
        record.material,
        composition.visibleText,
        composition.compositionFocus,
        composition.mainImageSuitabilityReason
    ].some((item) => Boolean(normalizeText(item)));
    const hasListField = [record.sellingPointObservations, record.styleTags].some((item) => (
        Array.isArray(item) && item.some((entry) => Boolean(normalizeText(entry)))
    ));
    const hasEnumField = Boolean(
        composition.assetNature
        || composition.subjectCoverageRatio
        || composition.subjectPosition
        || composition.mainImageSuitability
    );
    return hasTextField || hasListField || hasEnumField;
}

/**
 * 缓存条目择优用的宽松形状：持久化缓存里可能同时存在多代写入方的条目
 * （project-image-analysis:* / project-visual:* 等），字段可能缺失，故全部按 unknown 兼容。
 */
export interface ProjectVisualInsightCacheEntryLike {
    updatedAt?: unknown;
    insight?: unknown;
}

/**
 * 判断缓存条目的 insight 是否携带任一构图理解字段
 * （mainImageSuitability / subjectCoverageRatio / subjectPosition / compositionFocus）。
 */
export function projectVisualInsightEntryHasCompositionSignal(
    entry: ProjectVisualInsightCacheEntryLike | null | undefined
): boolean {
    const insight = entry?.insight;
    if (!insight || typeof insight !== 'object') return false;
    const composition = normalizeProjectVisualInsightCompositionFields(insight as Record<string, unknown>);
    return Boolean(
        composition.mainImageSuitability
        || composition.subjectCoverageRatio
        || composition.subjectPosition
        || composition.compositionFocus
    );
}

function parseProjectVisualInsightEntryTimestampMs(entry: ProjectVisualInsightCacheEntryLike): number {
    const insight = entry.insight && typeof entry.insight === 'object'
        ? entry.insight as Record<string, unknown>
        : null;
    const raw = normalizeText(entry.updatedAt) || normalizeText(insight?.capturedAt);
    if (!raw) return Number.NaN;
    return Date.parse(raw);
}

/**
 * 同一素材路径存在多条缓存条目时的择优规则（信号富度优先）：
 * ① 含任一构图理解字段的条目优先于不含的——例如 cache-fill 写入的 project-visual:* 条目
 *    必须盖过 project-image-analysis:* 只有 productType/summary 的旧条目，无论谁在数组前面；
 * ② 同富度时取时间戳（entry.updatedAt，缺则 insight.capturedAt）最新的一条；
 * ③ 双方时间戳缺失、不可解析或相同时，取后写入的一条（incoming）。
 * 调用方必须按缓存数组顺序 reduce：incoming 是数组中更靠后（更晚写入）的条目。
 */
export function pickPreferredProjectVisualInsightCacheEntry<T extends ProjectVisualInsightCacheEntryLike>(
    current: T | undefined,
    incoming: T
): T {
    if (!current) return incoming;
    const currentHasComposition = projectVisualInsightEntryHasCompositionSignal(current);
    const incomingHasComposition = projectVisualInsightEntryHasCompositionSignal(incoming);
    if (currentHasComposition !== incomingHasComposition) {
        return incomingHasComposition ? incoming : current;
    }
    const currentTs = parseProjectVisualInsightEntryTimestampMs(current);
    const incomingTs = parseProjectVisualInsightEntryTimestampMs(incoming);
    if (Number.isFinite(currentTs) && Number.isFinite(incomingTs) && currentTs !== incomingTs) {
        return incomingTs > currentTs ? incoming : current;
    }
    return incoming;
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function rolePreferenceScore(role: ProjectAssetRole, scenario: ProjectVisualSamplingScenario): number {
    const roles = ROLE_PREFERENCE_BY_SCENARIO[scenario] || ROLE_PREFERENCE_BY_SCENARIO.unknown;
    const index = roles.indexOf(role);
    if (index < 0) return 0;
    return (roles.length - index) * 25;
}

function isExpired(expiresAt: string | undefined, nowMs: number): boolean {
    if (!expiresAt) return false;
    const expiresMs = Date.parse(expiresAt);
    return Number.isFinite(expiresMs) && expiresMs <= nowMs;
}

function findCacheEntry(
    candidate: ProjectAssetIndexVisionCandidate,
    cacheKey: string,
    cachedInsights: ProjectVisualSamplingCacheEntry[]
): ProjectVisualSamplingCacheEntry | undefined {
    return cachedInsights.find((entry) => {
        if (entry.cacheKey === cacheKey) return true;
        return Boolean(entry.path && normalizePath(entry.path) === normalizePath(candidate.path));
    });
}

function cacheStatusForEntry(
    entry: ProjectVisualSamplingCacheEntry | undefined,
    nowMs: number
): ProjectVisualSamplingCacheStatus {
    if (!hasConcreteProjectVisualInsight(entry?.insight)) return 'miss';
    if (isExpired(entry.expiresAt || entry.insight.expiresAt, nowMs)) return 'stale';
    return 'hit';
}

function buildCacheSummary(candidates: ProjectVisualSamplingCandidate[]): ProjectVisualSamplingPlan['cacheSummary'] {
    return candidates.reduce((summary, candidate) => {
        summary[candidate.cacheStatus] += 1;
        if (candidate.shouldAnalyze) summary.shouldAnalyze += 1;
        return summary;
    }, { hit: 0, miss: 0, stale: 0, shouldAnalyze: 0 });
}

function assetById(assetIndex: ProjectAssetIndex): Map<string, ProjectAssetIndexAsset> {
    const map = new Map<string, ProjectAssetIndexAsset>();
    for (const asset of assetIndex.assets || []) {
        map.set(asset.id, asset);
    }
    return map;
}

function scoreCandidate(
    candidate: ProjectAssetIndexVisionCandidate,
    asset: ProjectAssetIndexAsset | undefined,
    scenario: ProjectVisualSamplingScenario
): number {
    return rolePreferenceScore(candidate.role, scenario)
        + candidate.priority
        + Math.round((asset?.confidence || 0) * 10);
}

export function buildProjectVisualSamplingCacheKey(asset: Pick<ProjectAssetIndexAsset, 'id' | 'path' | 'role' | 'sizeBytes' | 'width' | 'height'>): string {
    const source = [
        normalizeText(asset.id),
        normalizePath(asset.path),
        normalizeText(asset.role),
        normalizeText(asset.sizeBytes),
        normalizeText(asset.width),
        normalizeText(asset.height)
    ].join('|');
    return `project-visual:${stableHash(source)}`;
}

export function buildProjectVisualSamplingPlan(input: BuildProjectVisualSamplingPlanInput): ProjectVisualSamplingPlan {
    const scenario = input.scenario || 'general-design';
    const visualBudget = buildProjectVisualSamplingBudget({
        scenario,
        requestedMaxCandidates: input.maxCandidates
    });
    const maxCandidates = visualBudget.maxCandidates;
    const nowIso = input.nowIso || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const assetIndex = input.assetIndex || null;
    const cachedInsights = input.cachedInsights || [];
    const warnings: string[] = [];

    if (!assetIndex) {
        warnings.push('缺少 ProjectAssetIndex，无法生成可靠视觉抽样候选。');
    }
    if (maxCandidates === 0) {
        warnings.push('视觉抽样候选上限为 0，本轮不会建议调用视觉模型。');
    }

    const assetLookup = assetIndex ? assetById(assetIndex) : new Map<string, ProjectAssetIndexAsset>();
    const sortedCandidates = [...(assetIndex?.visionCandidates || [])]
        .map((candidate) => ({
            candidate,
            asset: assetLookup.get(candidate.assetId),
            score: scoreCandidate(candidate, assetLookup.get(candidate.assetId), scenario)
        }))
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return normalizePath(left.candidate.path).localeCompare(normalizePath(right.candidate.path));
        });

    const selectedCandidates: ProjectVisualSamplingCandidate[] = sortedCandidates.slice(0, maxCandidates).map(({ candidate, asset, score }): ProjectVisualSamplingCandidate => {
        const cacheKey = asset
            ? buildProjectVisualSamplingCacheKey(asset)
            : `project-visual:${stableHash(`${candidate.assetId}|${candidate.path}|${candidate.role}`)}`;
        const cacheEntry = findCacheEntry(candidate, cacheKey, cachedInsights);
        const cacheStatus = cacheStatusForEntry(cacheEntry, Number.isFinite(nowMs) ? nowMs : Date.now());
        return {
            assetId: candidate.assetId,
            path: normalizePath(candidate.path),
            role: candidate.role,
            priority: candidate.priority,
            score,
            reason: candidate.reason,
            cacheKey,
            cacheStatus,
            shouldAnalyze: cacheStatus !== 'hit',
            requiredObservations: [
                'image pixels or thumbnail must be inspected by a visual model or human',
                'product type, scene, material, and usable design role must come from a visual-model or human observation'
            ],
            cachedInsight: cacheStatus === 'hit' ? cacheEntry?.insight : undefined,
            selectionNotes: [{
                source: normalizePath(candidate.path),
                summary: `项目素材候选：role=${candidate.role}; cache=${cacheStatus}.`
            }]
        };
    });

    if (assetIndex && assetIndex.visionCandidates.length > 0 && selectedCandidates.length === 0) {
        warnings.push('项目存在视觉候选图，但本轮上限或过滤规则导致没有选中图片。');
    }

    const cacheSummary = buildCacheSummary(selectedCandidates);

    return {
        planVersion: 'project-visual-sampling/v0',
        mode: 'bounded-metadata-plan',
        scenario,
        maxCandidates,
        selectedCandidates,
        skippedCandidateCount: Math.max(0, (assetIndex?.visionCandidates.length || 0) - selectedCandidates.length),
        cacheSummary,
        warnings,
        limitations: [
            'VisualSamplingPlan 只决定最多分析哪些候选图，不读取图片像素，不调用视觉模型。',
            'cache hit 只代表已有画面观察可复用，不代表审美质量通过。',
            'miss/stale 只是后续视觉模型候选，不得编造产品款式、场景或卖点。',
            '该计划不改变 Photoshop 执行参数，也不替代真实验收。'
        ],
        sourceRecords: selectedCandidates.flatMap((candidate) => candidate.selectionNotes)
    };
}
