import {
    REFERENCE_STYLE_RECIPES,
    type ReferenceStyleRecipe
} from './reference-replication-style-recipes';
import {
    DESIGN_DOMAIN_CONCEPTS,
    type DesignDomainConcept
} from './design-domain-knowledge';
import {
    COPYWRITING_CORE_FORMULA,
    COPYWRITING_SCORE_CRITERIA,
    COPYWRITING_TEMPLATES,
    formatCopywritingFrameworkForKnowledge
} from './design-copywriting-framework';
import {
    searchDesignMemoryKnowledge,
    type DesignMemoryItem
} from './design-memory-knowledge';
import { ALL_PAIN_POINTS, type PainPoint } from './knowledge/pain-points';
import { ALL_SELLING_POINTS, type SellingPoint } from './knowledge/selling-points';
import {
    SOCKS_CATEGORIES,
    MATERIALS,
    STYLES,
    type ProductCategory,
    type MaterialInfo,
    type StyleInfo
} from './knowledge/socks-categories';
import {
    buildBundledKnowledgeRevision,
    governDesignKnowledgeResult,
    governExternalDesignKnowledgeResult,
    selectDesignKnowledgeResultsForUse,
    type DesignKnowledgeGovernanceRecord,
    type DesignKnowledgeUsageSnapshot
} from './design-knowledge-governance';

export type DesignKnowledgeIntent =
    | 'trend'
    | 'reference'
    | 'rule'
    | 'recipe'
    | 'brand'
    | 'platform_spec'
    | 'copywriting'
    | 'market_insight';

export type DesignKnowledgeSourceType =
    | 'local_recipe'
    | 'manual_rule'
    | 'design_crawler'
    | 'web_page'
    | 'mimo_web_search'
    | 'local_case'
    | 'eagle_library';

export type DesignKnowledgeAllowedUse =
    | 'prompt_context'
    | 'user_reference'
    | 'recipe_hint'
    | 'benchmark_seed';

export type DesignKnowledgeSourceLevel =
    | 'curated_rule'
    | 'curated_recipe'
    | 'external_snippet'
    | 'local_case'
    | 'benchmark_case'
    | 'unknown';

export interface DesignKnowledgeQuery {
    query: string;
    intents?: DesignKnowledgeIntent[];
    sourceTypes?: DesignKnowledgeSourceType[];
    limit?: number;
    memoryItems?: DesignMemoryItem[];
}

export interface DesignKnowledgeResult {
    id: string;
    title: string;
    intent: DesignKnowledgeIntent;
    sourceType: DesignKnowledgeSourceType;
    summary: string;
    sourceNotes: string[];
    tags: string[];
    allowedUses: DesignKnowledgeAllowedUse[];
    sourceLevel: DesignKnowledgeSourceLevel;
    sourceRank: number;
    sourceUrl?: string;
    updatedAt?: string;
    governance?: DesignKnowledgeGovernanceRecord;
}

export interface ExternalDesignKnowledgeInput {
    id?: string;
    title: string;
    intent?: DesignKnowledgeIntent;
    sourceType: Exclude<DesignKnowledgeSourceType, 'local_recipe' | 'manual_rule'>;
    summary: string;
    sourceNotes?: string[];
    tags?: string[];
    allowedUses?: unknown[];
    sourceLevel?: DesignKnowledgeSourceLevel;
    sourceRank?: number;
    sourceUrl?: string;
    updatedAt?: string;
    governance?: {
        sourceRevision?: string;
        retrievedAt?: string;
        publishedAt?: string;
        expiresAt?: string;
        lifecycleStatus?: 'active' | 'withdrawn' | 'superseded';
        supersededBy?: string;
    };
}

export interface DesignKnowledgeSearchResponse {
    query: string;
    results: DesignKnowledgeResult[];
    providerSummary: {
        localRecipe: number;
        manualRule: number;
        externalSearch: number;
        webPage: number;
        localCase: number;
    };
    warnings: string[];
    knowledgeUsageSnapshot: DesignKnowledgeUsageSnapshot;
}

const ALLOWED_KNOWLEDGE_USES: readonly DesignKnowledgeAllowedUse[] = [
    'prompt_context',
    'user_reference',
    'recipe_hint',
    'benchmark_seed'
];

function normalizeText(value: unknown): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function clampLimit(value: unknown): number {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 8;
    return Math.max(1, Math.min(30, Math.floor(num)));
}

function normalizeSourceLevel(value: unknown, fallback: DesignKnowledgeSourceLevel): DesignKnowledgeSourceLevel {
    const allowed: readonly DesignKnowledgeSourceLevel[] = [
        'curated_rule',
        'curated_recipe',
        'external_snippet',
        'local_case',
        'benchmark_case',
        'unknown'
    ];
    return allowed.includes(value as DesignKnowledgeSourceLevel)
        ? value as DesignKnowledgeSourceLevel
        : fallback;
}

function clampSourceRank(value: unknown, fallback = 40): number {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeAllowedUses(value: unknown[] | undefined): DesignKnowledgeAllowedUse[] {
    if (!Array.isArray(value)) return ['prompt_context', 'user_reference'];
    const filtered = value
        .filter((item): item is DesignKnowledgeAllowedUse => ALLOWED_KNOWLEDGE_USES.includes(item as DesignKnowledgeAllowedUse));
    return filtered.length ? Array.from(new Set(filtered)) : ['prompt_context', 'user_reference'];
}

function includesSourceType(query: DesignKnowledgeQuery, sourceType: DesignKnowledgeSourceType): boolean {
    return !Array.isArray(query.sourceTypes)
        || query.sourceTypes.length === 0
        || query.sourceTypes.includes(sourceType);
}

function includesIntent(query: DesignKnowledgeQuery, intent: DesignKnowledgeIntent): boolean {
    return !Array.isArray(query.intents)
        || query.intents.length === 0
        || query.intents.includes(intent);
}

export function normalizeExternalDesignKnowledgeResults(
    query: DesignKnowledgeQuery,
    inputs: ExternalDesignKnowledgeInput[]
): DesignKnowledgeResult[] {
    const queryText = normalizeText(query.query);
    const limit = clampLimit(query.limit);
    return inputs
        .filter((item) => includesSourceType(query, item.sourceType))
        .filter((item) => includesIntent(query, item.intent || 'reference'))
        .map((item, index): DesignKnowledgeResult => {
            const sourceKey = item.sourceType.replace(/_/g, '-');
            const result: DesignKnowledgeResult = {
                id: item.id || `${sourceKey}:${queryText || 'query'}:${index + 1}`,
                title: item.title,
                intent: item.intent || 'reference',
                sourceType: item.sourceType,
                summary: item.summary,
                sourceNotes: Array.isArray(item.sourceNotes) ? item.sourceNotes : [],
                tags: Array.from(new Set([...(item.tags || []), item.sourceType])),
                allowedUses: normalizeAllowedUses(item.allowedUses),
                sourceLevel: normalizeSourceLevel(item.sourceLevel, 'external_snippet'),
                sourceRank: clampSourceRank(item.sourceRank, 42),
                sourceUrl: item.sourceUrl,
                updatedAt: item.updatedAt
            };
            return governExternalDesignKnowledgeResult(result, {
                retrievedAt: item.governance?.retrievedAt || item.updatedAt,
                publishedAt: item.governance?.publishedAt,
                expiresAt: item.governance?.expiresAt,
                sourceRevision: item.governance?.sourceRevision,
                lifecycleStatus: item.governance?.lifecycleStatus,
                supersededBy: item.governance?.supersededBy
            });
        })
        .sort((a, b) => b.sourceRank - a.sourceRank || a.title.localeCompare(b.title, 'zh-Hans-CN'))
        .slice(0, limit);
}

export interface XiaomiWebSearchCitation {
    title?: string;
    url: string;
    summary?: string;
    siteName?: string;
}

/**
 * 把小米 MiMo web_search 的返回(综合结论 content + 来源 citations)转成统一外部知识输入，
 * 再交给 normalizeExternalDesignKnowledgeResults 标准化。
 * - content → 一条「综合设计要点」结果(sourceRank 最高，作主结论)
 * - 每条 citation → 一条来源结果(可点开看原页)
 */
export function buildXiaomiWebSearchKnowledgeInputs(params: {
    query: string;
    content: string;
    citations: XiaomiWebSearchCitation[];
    intent?: DesignKnowledgeIntent;
}): ExternalDesignKnowledgeInput[] {
    const intent = params.intent || 'trend';
    const queryText = normalizeText(params.query) || 'query';
    const inputs: ExternalDesignKnowledgeInput[] = [];

    const content = String(params.content || '').trim();
    if (content) {
        inputs.push({
            id: `mimo-web-search:summary:${queryText}`,
            title: `小米联网检索·${params.query} 设计要点`,
            intent,
            sourceType: 'mimo_web_search',
            summary: content.slice(0, 1500),
            sourceNotes: [
                '来源：小米 MiMo web_search 联网检索',
                '用途：趋势/配色/版式/文案方向参考，只借鉴风格方法，不照抄成品'
            ],
            allowedUses: ['prompt_context', 'user_reference'],
            sourceLevel: 'external_snippet',
            sourceRank: 90
        });
    }

    const seen = new Set<string>();
    (Array.isArray(params.citations) ? params.citations : []).forEach((cite, index) => {
        const url = String(cite?.url || '').trim();
        if (!url || seen.has(url)) return;
        seen.add(url);
        inputs.push({
            id: `mimo-web-search:cite:${index + 1}`,
            title: cite.title || cite.siteName || url,
            intent,
            sourceType: 'mimo_web_search',
            summary: cite.summary || cite.title || cite.siteName || url,
            tags: cite.siteName ? [cite.siteName] : [],
            allowedUses: ['user_reference'],
            sourceLevel: 'external_snippet',
            sourceRank: Math.max(40, 72 - index),
            sourceUrl: url
        });
    });

    return inputs;
}

function recipeSearchText(recipe: ReferenceStyleRecipe): string {
    return normalizeText([
        recipe.id,
        recipe.label,
        recipe.maturity,
        recipe.sourceFields.join(' '),
        recipe.currentExecution,
        recipe.limitation
    ].join(' '));
}

function recipeMatches(recipe: ReferenceStyleRecipe, queryText: string): boolean {
    if (!queryText) return true;
    const haystack = recipeSearchText(recipe);
    return queryText
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => haystack.includes(token));
}

function rankRecipe(recipe: ReferenceStyleRecipe, queryText: string): number {
    if (!queryText) return 62;
    const idOrLabel = normalizeText(`${recipe.id} ${recipe.label}`);
    if (queryText.split(/\s+/).some((token) => idOrLabel.includes(token))) {
        return 84;
    }
    return 70;
}

function recipeToKnowledgeResult(recipe: ReferenceStyleRecipe, queryText: string): DesignKnowledgeResult {
    return {
        id: `local-recipe:${recipe.id}`,
        title: recipe.label,
        intent: 'recipe',
        sourceType: 'local_recipe',
        summary: recipe.currentExecution,
        sourceNotes: [
            `成熟度：${recipe.maturity}`,
            `来源字段：${recipe.sourceFields.join(', ')}`,
            `边界：${recipe.limitation}`
        ],
        tags: ['reference-replication', 'photoshop-style', recipe.id, recipe.maturity],
        allowedUses: ['prompt_context', 'recipe_hint'],
        sourceLevel: 'curated_recipe',
        sourceRank: rankRecipe(recipe, queryText)
    };
}

function conceptIntent(concept: DesignDomainConcept): DesignKnowledgeIntent {
    if (concept.layer === 'recipe') return 'recipe';
    if (concept.layer === 'visual-case') return 'reference';
    return 'rule';
}

function conceptSearchText(concept: DesignDomainConcept): string {
    return normalizeText([
        concept.id,
        concept.zhName,
        concept.enName || '',
        concept.layer,
        concept.definition,
        concept.primaryGoal,
        concept.aliases.join(' '),
        concept.userIntentSignals.join(' '),
        concept.typicalInputs.join(' '),
        concept.typicalOutputs.join(' '),
        concept.commonModules.join(' '),
        concept.constraints.join(' '),
        concept.notThis.join(' ')
    ].join(' '));
}

function conceptMatches(concept: DesignDomainConcept, queryText: string): boolean {
    if (!queryText) return true;
    const haystack = conceptSearchText(concept);
    return queryText
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => haystack.includes(token));
}

function rankConcept(concept: DesignDomainConcept, queryText: string): number {
    if (!queryText) return 58;
    const nameText = normalizeText([concept.id, concept.zhName, concept.enName || '', concept.aliases.join(' ')].join(' '));
    if (queryText.split(/\s+/).some((token) => nameText.includes(token))) {
        return 82;
    }
    return 66;
}

function conceptToKnowledgeResult(concept: DesignDomainConcept, queryText: string): DesignKnowledgeResult {
    const intent = conceptIntent(concept);
    return {
        id: `manual-rule:${concept.id}`,
        title: `${concept.zhName} / ${concept.id}`,
        intent,
        sourceType: 'manual_rule',
        summary: `${concept.definition} 目标：${concept.primaryGoal}`,
        sourceNotes: [
            `层级：${concept.layer}`,
            `成熟度：${concept.maturity}`,
            `典型输入：${concept.typicalInputs.slice(0, 4).join(' / ')}`,
            `典型输出：${concept.typicalOutputs.slice(0, 4).join(' / ')}`,
            `边界：${concept.notThis.slice(0, 4).join(' / ')}`
        ],
        tags: ['design-domain', concept.layer, concept.id, concept.maturity],
        allowedUses: intent === 'recipe'
            ? ['prompt_context', 'recipe_hint']
            : ['prompt_context', 'user_reference'],
        sourceLevel: 'curated_rule',
        sourceRank: rankConcept(concept, queryText)
    };
}

function copywritingFrameworkMatches(queryText: string): boolean {
    if (!queryText) return true;
    const triggerTokens = [
        'copywriting',
        'copy',
        '文案',
        '配文',
        '图文',
        '广告感',
        '卖点',
        '视觉锚点',
        '用户场景',
        '产品价值',
        '低广告感'
    ];
    if (triggerTokens.some((token) => queryText.includes(token))) return true;

    const haystack = normalizeText([
        ...triggerTokens,
        COPYWRITING_CORE_FORMULA,
        COPYWRITING_TEMPLATES.map((item) => item.name).join(' ')
    ].join(' '));
    return queryText
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => haystack.includes(token));
}

function copywritingFrameworkToKnowledgeResult(): DesignKnowledgeResult {
    return {
        id: 'manual-rule:copywriting-framework',
        title: '图文文案撰写框架',
        intent: 'copywriting',
        sourceType: 'manual_rule',
        summary: formatCopywritingFrameworkForKnowledge(),
        sourceNotes: [
            '结构：人群设定 -> 兴趣方向 -> 场景代入 -> 痛点转译 -> 情绪表达 -> 产品卖点 -> 事实核对 -> 图文匹配 -> 轻行动引导 -> 风险检查',
            'P-I-S-B-F-C：People -> Interest -> Scene -> Benefit -> Facts -> Conversion',
            `可选模板：${COPYWRITING_TEMPLATES.map((item) => item.name).join(' / ')}`,
            `评分项：${COPYWRITING_SCORE_CRITERIA.map((item) => `${item.label}${item.points}分`).join(' / ')}`,
            '边界：没有目标人群、图片可见信息、产品事实或用户场景时，不能编造文案内容。'
        ],
        tags: ['copywriting', 'audience-interest', 'visual-anchor', 'user-scene', 'product-value', 'safety-check'],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'curated_rule',
        sourceRank: 86
    };
}

// ── 市场洞察（用户调研沉淀）：痛点/卖点/类目/材质/风格库 ──
// 来源定位：这是「淘宝问大家式」用户调研的离线沉淀（用户心声 + 解决方案 + 视觉表现建议），
// 是设计流程第 2 步「市场调研 → 提炼卖点 → 定人群风格」在无法实时爬取时的替身。
// 品类边界：目前仅覆盖袜子类目；非袜子查询在入口直接跳过，避免把具体卖点污染到其他品类。

const MARKET_INSIGHT_SOURCE_NOTE = '来源：袜子品类用户调研沉淀（问大家式痛点/用户在意点整理），非实时数据';

function tokenMatches(haystack: string, queryText: string): boolean {
    return queryText
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => haystack.includes(token));
}

const SOCKS_CATEGORY_QUERY_TOKENS = Array.from(new Set([
    '袜',
    '袜子',
    'sock',
    'socks',
    ...SOCKS_CATEGORIES.flatMap((category) => [category.name, ...category.alias])
].map(normalizeText).filter(Boolean)));

function isExplicitSocksMarketInsightQuery(queryText: string): boolean {
    return SOCKS_CATEGORY_QUERY_TOKENS.some((token) => queryText.includes(token));
}

function stripSocksCategoryScopeTerms(queryText: string): string {
    let relevanceQuery = queryText;
    const longestFirst = [...SOCKS_CATEGORY_QUERY_TOKENS]
        .sort((left, right) => right.length - left.length);
    for (const token of longestFirst) {
        relevanceQuery = relevanceQuery.split(token).join(' ');
    }
    return normalizeText(relevanceQuery);
}

function painPointSearchText(point: PainPoint): string {
    return normalizeText([
        point.id,
        point.title,
        point.scenario,
        point.userVoice,
        point.solutionTitle,
        point.solutionDescription,
        point.type,
        point.categories.join(' '),
        '痛点 用户痛点 顾虑 担心 市场调研 问大家'
    ].join(' '));
}

function painPointSpecificText(point: PainPoint): string {
    return normalizeText([
        point.title,
        point.scenario,
        point.userVoice,
        point.solutionTitle,
        point.solutionDescription
    ].join(' '));
}

function painPointToKnowledgeResult(point: PainPoint, queryText: string): DesignKnowledgeResult {
    const suggestion = point.designSuggestion;
    const specificHit = tokenMatches(painPointSpecificText(point), queryText);
    return {
        id: `market-insight:pain:${point.id}`,
        title: `痛点·${point.title} → ${point.solutionTitle}`,
        intent: 'market_insight',
        sourceType: 'manual_rule',
        summary: `用户心声：「${point.userVoice}」（场景：${point.scenario}）。解决方案：${point.solutionDescription}`,
        sourceNotes: [
            `视觉表现建议：${suggestion.visualElements.join(' / ')}；配色风格：${suggestion.colorStyle}；文案风格：${suggestion.copyStyle}`,
            `严重程度：${point.severity}/5；痛点类型：${point.type}；适用类目：${point.categories.join('、')}`,
            ...(point.relatedSellingPoints.length
                ? [`关联卖点 id：${point.relatedSellingPoints.join('、')}（可用于组织该屏卖点与画面信息）`]
                : []),
            MARKET_INSIGHT_SOURCE_NOTE
        ],
        tags: ['market-insight', 'pain-point', 'socks', point.type],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'curated_rule',
        sourceRank: specificHit ? Math.min(85, 62 + point.severity * 4) : 48 + point.severity * 2
    };
}

function sellingPointSearchText(point: SellingPoint): string {
    return normalizeText([
        point.id,
        point.title,
        point.description,
        point.detail || '',
        point.keywords.join(' '),
        point.scenes.join(' '),
        point.type,
        '卖点 优势 提炼'
    ].join(' '));
}

function sellingPointSpecificText(point: SellingPoint): string {
    return normalizeText([
        point.title,
        point.description,
        point.detail || '',
        point.keywords.join(' '),
        point.scenes.join(' ')
    ].join(' '));
}

function sellingPointToKnowledgeResult(point: SellingPoint, queryText: string): DesignKnowledgeResult {
    const specificHit = tokenMatches(sellingPointSpecificText(point), queryText);
    return {
        id: `market-insight:selling:${point.id}`,
        title: `卖点·${point.title}`,
        intent: 'market_insight',
        sourceType: 'manual_rule',
        summary: `${point.description}${point.detail ? `。${point.detail}` : ''}`,
        sourceNotes: [
            `卖点类型：${point.type}；优先级：${point.priority}/5；适用场景：${point.scenes.join('、')}`,
            ...(point.labelStyle ? [`建议标签样式：${point.labelStyle}${point.suggestedColors?.length ? `；推荐配色：${point.suggestedColors.join(' ')}` : ''}`] : []),
            '提炼原则：有效卖点 = 产品优势 ∩ 用户在意 ∩ 竞品不突出；落屏时须与素材和产品事实一致，不可堆砌空话',
            MARKET_INSIGHT_SOURCE_NOTE
        ],
        tags: ['market-insight', 'selling-point', 'socks', point.type],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'curated_rule',
        sourceRank: specificHit ? Math.min(82, 58 + point.priority * 4) : 46 + point.priority * 2
    };
}

function categorySearchText(category: ProductCategory): string {
    return normalizeText([
        category.id,
        category.name,
        category.alias.join(' '),
        category.description,
        category.keywords.join(' '),
        category.targetAudience.join(' '),
        category.features.join(' '),
        '类目 品类 人群'
    ].join(' '));
}

function categoryToKnowledgeResult(category: ProductCategory): DesignKnowledgeResult {
    return {
        id: `market-insight:category:${category.id}`,
        title: `类目·${category.name}`,
        intent: 'market_insight',
        sourceType: 'manual_rule',
        summary: category.description,
        sourceNotes: [
            `目标人群：${category.targetAudience.join('、')}`,
            `特征：${category.features.slice(0, 5).join(' / ')}`,
            `常用材质：${category.commonMaterials.join('、')}；价格带：${category.priceRange.low}-${category.priceRange.high} 元`,
            MARKET_INSIGHT_SOURCE_NOTE
        ],
        tags: ['market-insight', 'category', 'socks', category.id],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'curated_rule',
        sourceRank: 64
    };
}

function materialSearchText(material: MaterialInfo): string {
    return normalizeText([
        material.id,
        material.name,
        material.alias.join(' '),
        material.description,
        material.features.join(' '),
        material.benefits.join(' '),
        '材质 面料'
    ].join(' '));
}

function materialToKnowledgeResult(material: MaterialInfo): DesignKnowledgeResult {
    return {
        id: `market-insight:material:${material.id}`,
        title: `材质·${material.name}`,
        intent: 'market_insight',
        sourceType: 'manual_rule',
        summary: material.description,
        sourceNotes: [
            `优势：${material.benefits.join(' / ')}`,
            `局限：${material.drawbacks.join(' / ')}（文案不可回避成缺陷宣传，可正面转译）`,
            `价格档：${material.priceLevel}`,
            MARKET_INSIGHT_SOURCE_NOTE
        ],
        tags: ['market-insight', 'material', 'socks', material.id],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'curated_rule',
        sourceRank: 63
    };
}

function styleSearchText(style: StyleInfo): string {
    return normalizeText([
        style.id,
        style.name,
        style.description,
        style.keywords.join(' '),
        style.targetAudience.join(' '),
        style.designElements.join(' '),
        '风格 调性'
    ].join(' '));
}

function styleToKnowledgeResult(style: StyleInfo): DesignKnowledgeResult {
    return {
        id: `market-insight:style:${style.id}`,
        title: `风格·${style.name}`,
        intent: 'market_insight',
        sourceType: 'manual_rule',
        summary: style.description,
        sourceNotes: [
            `目标人群：${style.targetAudience.join('、')}`,
            `偏好配色：${style.colorPreferences.join('、')}`,
            `典型设计元素：${style.designElements.join(' / ')}`,
            MARKET_INSIGHT_SOURCE_NOTE
        ],
        tags: ['market-insight', 'style', 'socks', style.id],
        allowedUses: ['prompt_context', 'user_reference'],
        sourceLevel: 'curated_rule',
        sourceRank: 65
    };
}

/**
 * 市场洞察检索：空查询不返回（意图不明时不用品类调研淹没结果），有查询时按 token 匹配。
 */
function searchMarketInsightKnowledge(queryText: string): DesignKnowledgeResult[] {
    if (!queryText) return [];
    const results: DesignKnowledgeResult[] = [];
    for (const point of ALL_PAIN_POINTS) {
        if (tokenMatches(painPointSearchText(point), queryText)) {
            results.push(painPointToKnowledgeResult(point, queryText));
        }
    }
    for (const point of ALL_SELLING_POINTS) {
        if (tokenMatches(sellingPointSearchText(point), queryText)) {
            results.push(sellingPointToKnowledgeResult(point, queryText));
        }
    }
    for (const category of SOCKS_CATEGORIES) {
        if (tokenMatches(categorySearchText(category), queryText)) {
            results.push(categoryToKnowledgeResult(category));
        }
    }
    for (const material of MATERIALS) {
        if (tokenMatches(materialSearchText(material), queryText)) {
            results.push(materialToKnowledgeResult(material));
        }
    }
    for (const style of STYLES) {
        if (tokenMatches(styleSearchText(style), queryText)) {
            results.push(styleToKnowledgeResult(style));
        }
    }
    return results;
}

export function searchLocalDesignKnowledge(query: DesignKnowledgeQuery): DesignKnowledgeSearchResponse {
    const queryText = normalizeText(query.query);
    const limit = clampLimit(query.limit);
    const warnings: string[] = [];
    const results: DesignKnowledgeResult[] = [];

    if (includesIntent(query, 'recipe') && includesSourceType(query, 'local_recipe')) {
        results.push(
            ...REFERENCE_STYLE_RECIPES
                .filter((recipe) => recipeMatches(recipe, queryText))
                .map((recipe) => recipeToKnowledgeResult(recipe, queryText))
        );
    }

    if (includesSourceType(query, 'manual_rule')) {
        results.push(
            ...DESIGN_DOMAIN_CONCEPTS
                .filter((concept) => includesIntent(query, conceptIntent(concept)))
                .filter((concept) => conceptMatches(concept, queryText))
                .map((concept) => conceptToKnowledgeResult(concept, queryText))
        );
    }

    if (
        includesSourceType(query, 'manual_rule')
        && includesIntent(query, 'copywriting')
        && copywritingFrameworkMatches(queryText)
    ) {
        results.push(copywritingFrameworkToKnowledgeResult());
    }

    if (
        includesSourceType(query, 'manual_rule')
        && includesIntent(query, 'market_insight')
        && isExplicitSocksMarketInsightQuery(queryText)
    ) {
        const relevanceQuery = stripSocksCategoryScopeTerms(queryText) || queryText;
        results.push(...searchMarketInsightKnowledge(relevanceQuery));
    } else if (
        queryText
        && Array.isArray(query.intents)
        && query.intents.includes('market_insight')
        && !isExplicitSocksMarketInsightQuery(queryText)
    ) {
        warnings.push('当前本地 market_insight 仅覆盖袜子类目；查询未明确袜子类目，已跳过该品类知识，避免跨品类污染。');
    }

    if (includesSourceType(query, 'local_case')) {
        results.push(...searchDesignMemoryKnowledge(query, query.memoryItems));
    }

    results.sort((a, b) => b.sourceRank - a.sourceRank || a.title.localeCompare(b.title, 'zh-Hans-CN'));

    if (!results.length) {
        warnings.push('本地知识库（Photoshop style recipe + 设计领域手工规则）未匹配到该查询；更多结果将来自外部搜索源（小米 web_search / SearXNG）。');
    }

    const governedResults = results.map((result) => (
        result.governance
            ? result
            : governDesignKnowledgeResult(result, {
                provenance: 'bundled_curated',
                sourceRevision: buildBundledKnowledgeRevision('design-knowledge-2026-07-12'),
                retrievedAt: '2026-07-12T00:00:00.000Z'
            })
    ));
    const selectedResults = governedResults.slice(0, limit);
    return {
        query: query.query,
        results: selectedResults,
        providerSummary: {
            localRecipe: selectedResults.filter((item) => item.sourceType === 'local_recipe').length,
            manualRule: selectedResults.filter((item) => item.sourceType === 'manual_rule').length,
            externalSearch: 0,
            webPage: 0,
            localCase: selectedResults.filter((item) => item.sourceType === 'local_case').length
        },
        warnings,
        knowledgeUsageSnapshot: selectDesignKnowledgeResultsForUse(selectedResults, {
            query: query.query,
            purpose: 'planning'
        }).snapshot
    };
}
