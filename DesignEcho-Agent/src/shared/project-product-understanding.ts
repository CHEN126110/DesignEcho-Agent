import type { ProjectAssetIndex, ProjectAssetIndexAsset, ProjectAssetRole } from './project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';
import {
    hasConcreteProjectVisualInsight,
    type ProjectVisualInsight
} from './project-visual-sampling';

export interface ProjectProductUnderstandingAsset {
    assetId: string;
    path: string;
    relativePath: string;
    role: ProjectAssetRole;
    visualInsightAvailable: boolean;
    observedProductType?: string;
    observedSummary?: string;
}

export interface ProjectProductUnderstanding {
    version: 'project-product-understanding/v1';
    layer: 'observed_context';
    observations: {
        productTypes: string[];
        materials: string[];
        scenes: string[];
        styleTags: string[];
        sellingPointObservations: string[];
        visualSummaries: string[];
    };
    assetGroups: {
        skuSourceCandidates: ProjectProductUnderstandingAsset[];
        productStillCandidates: ProjectProductUnderstandingAsset[];
        detailCandidates: ProjectProductUnderstandingAsset[];
        modelWearCandidates: ProjectProductUnderstandingAsset[];
        unclassifiedCandidates: ProjectProductUnderstandingAsset[];
    };
    coverage: {
        assetCount: number;
        imageAssetCount: number;
        visualInsightCount: number;
        linkedVisualInsightCount: number;
    };
    warnings: string[];
    limitations: string[];
}

export interface BuildProjectProductUnderstandingInput {
    assetIndex?: ProjectAssetIndex | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
}

function clean(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return clean(value).replace(/\\/g, '/');
}

function pathBasename(value: unknown): string {
    const normalized = normalizePath(value);
    if (!normalized) return '';
    return normalized.split('/').filter(Boolean).pop() || '';
}

function unique(values: unknown[], maxItems: number = 24): string[] {
    return Array.from(new Set(values.map(clean).filter(Boolean))).slice(0, maxItems);
}

function buildVisualInsightLookup(
    cache?: ProjectVisualInsightCacheReadResult | null
): Map<string, ProjectVisualInsight> {
    const lookup = new Map<string, ProjectVisualInsight>();
    for (const entry of cache?.entries || []) {
        const insight = entry.insight;
        if (!hasConcreteProjectVisualInsight(insight)) continue;
        for (const key of [entry.path, insight.path].map(normalizePath).filter(Boolean)) {
            lookup.set(key, insight);
        }
    }
    return lookup;
}

function collectVisualInsights(cache?: ProjectVisualInsightCacheReadResult | null): ProjectVisualInsight[] {
    const insights: ProjectVisualInsight[] = [];
    const seen = new Set<string>();
    for (const entry of cache?.entries || []) {
        const insight = entry.insight;
        if (!hasConcreteProjectVisualInsight(insight)) continue;
        const key = normalizePath(insight.path || entry.path || insight.assetId || entry.assetId);
        if (key && seen.has(key)) continue;
        insights.push(insight);
        if (key) seen.add(key);
    }
    return insights;
}

function findInsightForAsset(
    asset: ProjectAssetIndexAsset,
    lookup: Map<string, ProjectVisualInsight>
): ProjectVisualInsight | undefined {
    const assetPath = normalizePath(asset.path);
    const relativePath = normalizePath(asset.relativePath);
    const exact = [assetPath, relativePath].map((key) => lookup.get(key)).find(Boolean);
    if (exact) return exact;

    const suffixes = [assetPath, relativePath].filter(Boolean);
    for (const [key, insight] of lookup.entries()) {
        if (suffixes.some((suffix) => key.endsWith(`/${suffix}`) || suffix.endsWith(`/${key}`))) {
            return insight;
        }
    }

    const assetName = pathBasename(asset.name || asset.path);
    if (!assetName) return undefined;
    const sameNameMatches = Array.from(lookup.entries())
        .filter(([key]) => pathBasename(key) === assetName)
        .map(([, insight]) => insight);
    return sameNameMatches.length === 1 ? sameNameMatches[0] : undefined;
}

function toUnderstandingAsset(
    asset: ProjectAssetIndexAsset,
    insight?: ProjectVisualInsight
): ProjectProductUnderstandingAsset {
    const concreteInsight = hasConcreteProjectVisualInsight(insight) ? insight : undefined;
    const productType = clean(concreteInsight?.productType);
    const summary = clean(concreteInsight?.summary);
    return {
        assetId: asset.id,
        path: asset.path,
        relativePath: asset.relativePath,
        role: asset.role,
        visualInsightAvailable: Boolean(concreteInsight),
        ...(productType ? { observedProductType: productType } : {}),
        ...(summary ? { observedSummary: summary } : {})
    };
}

function appendAssetByRole(
    groups: ProjectProductUnderstanding['assetGroups'],
    asset: ProjectProductUnderstandingAsset
): void {
    switch (asset.role) {
        case 'color-single':
            groups.skuSourceCandidates.push(asset);
            break;
        case 'raw-product-still':
            groups.productStillCandidates.push(asset);
            break;
        case 'raw-detail-closeup':
            groups.detailCandidates.push(asset);
            break;
        case 'raw-model-wear':
            groups.modelWearCandidates.push(asset);
            break;
        default:
            groups.unclassifiedCandidates.push(asset);
    }
}

/**
 * 将结构化素材索引与已经存在的视觉观察整理成中立项目上下文。
 *
 * 该函数不读取任务文本，不推断品类，不生成买家问题、卖点策略或设计方向。
 * 专业判断归模型声明的 R3 Strategy 与相应业务 Skill；本对象只回答“当前观察到了什么”。
 */
export function buildProjectProductUnderstanding(
    input: BuildProjectProductUnderstandingInput
): ProjectProductUnderstanding {
    const assetIndex = input.assetIndex || null;
    const assets = Array.isArray(assetIndex?.assets) ? assetIndex.assets : [];
    const imageAssets = assets.filter((asset) => asset.isImage && !asset.isOutput);
    const lookup = buildVisualInsightLookup(input.visualInsightCache);
    const insights = collectVisualInsights(input.visualInsightCache);
    const groups: ProjectProductUnderstanding['assetGroups'] = {
        skuSourceCandidates: [],
        productStillCandidates: [],
        detailCandidates: [],
        modelWearCandidates: [],
        unclassifiedCandidates: []
    };
    let linkedVisualInsightCount = 0;

    for (const asset of imageAssets) {
        const insight = findInsightForAsset(asset, lookup);
        if (insight) linkedVisualInsightCount += 1;
        appendAssetByRole(groups, toUnderstandingAsset(asset, insight));
    }

    const observations: ProjectProductUnderstanding['observations'] = {
        productTypes: unique(insights.map((insight) => insight.productType)),
        materials: unique(insights.map((insight) => insight.material)),
        scenes: unique(insights.map((insight) => insight.scene)),
        styleTags: unique(insights.flatMap((insight) => insight.styleTags || [])),
        sellingPointObservations: unique(insights.flatMap((insight) => insight.sellingPointObservations || [])),
        visualSummaries: unique(insights.map((insight) => insight.summary), 12)
    };

    return {
        version: 'project-product-understanding/v1',
        layer: 'observed_context',
        observations,
        assetGroups: groups,
        coverage: {
            assetCount: assets.length,
            imageAssetCount: imageAssets.length,
            visualInsightCount: insights.length,
            linkedVisualInsightCount
        },
        warnings: [
            insights.length === 0 ? '当前没有可复用的画面观察缓存；产品观察保持为空，不根据任务文本或文件名补造。' : '',
            groups.skuSourceCandidates.length === 0 ? '素材索引没有标记为 color-single 的 SKU 单色源候选。' : ''
        ].filter(Boolean),
        limitations: [
            'ProjectProductUnderstanding 只整理结构化素材角色与已有视觉观察，不生成任务 Brief、设计策略或执行计划。',
            'productType、material、styleTags 和 sellingPointObservations 都来自素材观察，不能替代用户确认或商品参数。',
            '素材角色候选不授予 Tool 权限，也不证明对应素材适合最终设计或质量已经通过。'
        ]
    };
}
