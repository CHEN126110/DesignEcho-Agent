import type { ProjectAssetIndex, ProjectAssetIndexAsset, ProjectAssetRole } from './project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';
import {
    hasConcreteProjectVisualInsight,
    type ProjectVisualInsight
} from './project-visual-sampling';

export type SkuCardAssetCandidateVersion = 'sku-card-asset-candidates/v0';
export type SkuCardAssetCandidateMode = 'card-style';
export type SkuCardRecommendedUse = 'primary_sku_card' | 'secondary_sku_card' | 'reference_only' | 'reject';
export type SkuCardVisualObservationStatus = 'matched_insight' | 'missing_insight';

export interface SkuCardAssetCandidate {
    assetId: string;
    path: string;
    relativePath: string;
    role: ProjectAssetRole;
    score: number;
    recommendedUse: SkuCardRecommendedUse;
    needsVisualConfirmation: boolean;
    visualObservationStatus: SkuCardVisualObservationStatus;
    skuColorName?: string;
    reasons: string[];
    warnings: string[];
}

export interface SkuCardVisualInsightCoverage {
    totalCacheEntries: number;
    entriesWithInsight: number;
    selectedCandidateCount: number;
    matchedCandidateCount: number;
    candidatesNeedingConfirmation: number;
}

export interface SkuCardAssetCandidateReport {
    version: SkuCardAssetCandidateVersion;
    mode: SkuCardAssetCandidateMode;
    status: 'ready_for_selection' | 'needs_visual_confirmation' | 'blocked_no_candidates';
    candidateCount: number;
    candidates: SkuCardAssetCandidate[];
    visualInsightCoverage: SkuCardVisualInsightCoverage;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface BuildSkuCardAssetCandidateReportInput {
    assetIndex?: ProjectAssetIndex | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
    maxCandidates?: number;
}

interface FolderSequenceSignal {
    folderKey: string;
    squareFlatLayImageCount: number;
    nestedFlatLayFolder: boolean;
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return normalizeText(value).replace(/\\/g, '/');
}

function normalizeSearchText(value: unknown): string {
    return normalizeText(value).toLowerCase();
}

function hasPathHint(asset: ProjectAssetIndexAsset, hint: string): boolean {
    return normalizePath(asset.relativePath || asset.path).includes(hint);
}

function pathSegments(value: unknown): string[] {
    return normalizePath(value).split('/').filter(Boolean);
}

function parentPath(value: unknown): string {
    const segments = pathSegments(value);
    return segments.slice(0, -1).join('/');
}

function isFlatLaySegment(value: string): boolean {
    return value.includes('平铺') || /flat[-_\s]?lay|flatlay/i.test(value);
}

function flatLaySegmentIndex(asset: ProjectAssetIndexAsset): number {
    return pathSegments(asset.relativePath || asset.path).findIndex(isFlatLaySegment);
}

function isSquareLikeAsset(asset: ProjectAssetIndexAsset): boolean {
    const width = Number(asset.width || 0);
    const height = Number(asset.height || 0);
    if (width <= 0 || height <= 0) return false;
    const ratio = width / height;
    return ratio >= 0.92 && ratio <= 1.08;
}

function squareScore(asset: ProjectAssetIndexAsset): number {
    const width = Number(asset.width || 0);
    const height = Number(asset.height || 0);
    if (width <= 0 || height <= 0) return 0;

    const ratio = width / height;
    if (ratio >= 0.92 && ratio <= 1.08) return 14;
    if (ratio >= 0.75 && ratio <= 1.35) return 8;
    return -6;
}

function roleBaseScore(role: ProjectAssetRole): number {
    switch (role) {
        case 'color-single':
            return 72;
        case 'raw-product-still':
            return 68;
        case 'raw-detail-closeup':
            return 38;
        case 'raw-model-wear':
            return 12;
        default:
            return 0;
    }
}

function recommendedUseFromScore(role: ProjectAssetRole, score: number): SkuCardRecommendedUse {
    if (role === 'raw-model-wear') return 'reference_only';
    if (score >= 76) return 'primary_sku_card';
    if (score >= 56) return 'secondary_sku_card';
    if (score >= 24) return 'reference_only';
    return 'reject';
}

function buildVisualInsightLookup(visualInsightCache?: ProjectVisualInsightCacheReadResult | null): Map<string, ProjectVisualInsight> {
    const lookup = new Map<string, ProjectVisualInsight>();
    for (const entry of visualInsightCache?.entries || []) {
        const insight = entry.insight;
        if (!hasConcreteProjectVisualInsight(insight)) continue;
        const keys = [
            entry.path,
            insight.path
        ]
            .map((item) => normalizePath(item))
            .filter(Boolean);
        for (const key of keys) lookup.set(key, insight);
    }
    return lookup;
}

function findVisualInsight(asset: ProjectAssetIndexAsset, visualInsightLookup: Map<string, ProjectVisualInsight>): ProjectVisualInsight | undefined {
    return visualInsightLookup.get(normalizePath(asset.id)) || visualInsightLookup.get(normalizePath(asset.path));
}

function buildVisualInsightText(insight?: ProjectVisualInsight): string {
    if (!insight) return '';
    return [
        insight.summary,
        insight.productType,
        insight.scene,
        insight.material,
        ...(Array.isArray(insight.styleTags) ? insight.styleTags : [])
    ].map(normalizeSearchText).filter(Boolean).join(' ');
}

function inferSkuColorName(insight?: ProjectVisualInsight): string | undefined {
    if (!insight) return undefined;
    const text = [
        insight.productType,
        insight.summary,
        ...(Array.isArray(insight.styleTags) ? insight.styleTags : [])
    ].map(normalizeSearchText).filter(Boolean).join(' ');
    if (!text) return undefined;

    const colorRules: Array<[RegExp, string]> = [
        [/粉(?:色|红)?|浅粉|藕粉|pink/i, '粉色'],
        [/浅灰|灰(?:色)?|grey|gray/i, '灰色'],
        [/黑(?:色)?|black/i, '黑色'],
        [/浅咖|咖(?:色)?|卡其|米色|米黄|beige|khaki|tan/i, '浅咖'],
        [/奶白|米白|乳白|白(?:色)?|ivory|cream|white/i, '奶白'],
        [/蓝(?:色)?|blue/i, '蓝色'],
        [/绿(?:色)?|green/i, '绿色'],
        [/紫(?:色)?|purple/i, '紫色'],
        [/红(?:色)?|red/i, '红色'],
        [/黄(?:色)?|yellow/i, '黄色']
    ];
    return colorRules.find(([pattern]) => pattern.test(text))?.[1];
}

function buildFolderSequenceSignals(assets: ProjectAssetIndexAsset[]): Map<string, FolderSequenceSignal> {
    const folders = new Map<string, {
        assets: ProjectAssetIndexAsset[];
        nestedFlatLayFolder: boolean;
    }>();

    for (const asset of assets) {
        if (!asset.isImage || asset.isOutput || asset.role === 'raw-model-wear') continue;
        if (!isSquareLikeAsset(asset)) continue;

        const relativePath = asset.relativePath || asset.path;
        const parent = parentPath(relativePath);
        const segments = pathSegments(relativePath);
        const flatLayIndex = flatLaySegmentIndex(asset);
        if (!parent || flatLayIndex < 0) continue;

        const nestedFlatLayFolder = segments.length - 1 > flatLayIndex + 1;
        if (!nestedFlatLayFolder) continue;

        const current = folders.get(parent) || {
            assets: [],
            nestedFlatLayFolder
        };
        current.assets.push(asset);
        current.nestedFlatLayFolder = current.nestedFlatLayFolder || nestedFlatLayFolder;
        folders.set(parent, current);
    }

    const signals = new Map<string, FolderSequenceSignal>();
    for (const [folderKey, group] of folders.entries()) {
        const squareFlatLayImageCount = group.assets.length;
        if (squareFlatLayImageCount < 2 || squareFlatLayImageCount > 12) continue;
        signals.set(folderKey, {
            folderKey,
            squareFlatLayImageCount,
            nestedFlatLayFolder: group.nestedFlatLayFolder
        });
    }
    return signals;
}

function evaluateVisualInsightForSkuCard(
    insight?: ProjectVisualInsight,
    options: { hasSkuSequenceSignal?: boolean } = {}
): {
    hasInsight: boolean;
    scoreDelta: number;
    recommendedUseOverride?: SkuCardRecommendedUse;
    needsVisualConfirmation?: boolean;
    reasons: string[];
    warnings: string[];
} {
    const text = buildVisualInsightText(insight);
    if (!text) {
        return {
            hasInsight: false,
            scoreDelta: 0,
            needsVisualConfirmation: true,
            reasons: [],
            warnings: []
        };
    }

    const isModelWear = /模特|穿着|上脚|脚上|真人|model|wear|try[-\s]?on/.test(text);
    const isCloseup = /特写|局部|细节|微距|close[-\s]?up|detail|macro|texture/.test(text);
    const hasCountedMultiItem = /(?:二|两|三|四|五|六|七|八|九|十|[2-9])\s*(?:双|只|款|件|条|个|色|种|pcs|pairs?)/i.test(text);
    const isGroup = /合照|多只|多双|多款|多色|多种|组合图|组合|集合|group|multiple|several/.test(text)
        || hasCountedMultiItem;
    const isHandheld = /手拿|手持|拿着|抓着|hand[-\s]?held|holding/.test(text);
    const isSceneOnly = /类别[:：]\s*scene|\bscene\b|lifestyle/.test(text) && !/direct_use|sku卡片可用|card[-\s]?ready/.test(text);
    const hasSingleItemCount = /(?:一|1)\s*(?:双|只|款|件|条|个)/i.test(text);
    const hasProductMainSignal = /product_main|direct_use|card[-\s]?ready|sku卡片可用/.test(text);
    const hasExplicitSingleSignal = /单只|单个|单品|完整主体|主体完整|完整平铺|平铺单品|全貌|single|isolated|flat[-_\s]?lay\s*(?:single|product)|product\s*still/.test(text)
        || hasSingleItemCount;
    const isUsableSingle = hasExplicitSingleSignal
        || (hasProductMainSignal && options.hasSkuSequenceSignal === true);

    if (isModelWear) {
        return {
            hasInsight: true,
            scoreDelta: -40,
            recommendedUseOverride: 'reference_only',
            needsVisualConfirmation: false,
            reasons: ['视觉观察显示这是穿着或模特图，更适合作为参考。'],
            warnings: []
        };
    }

    if (isCloseup) {
        return {
            hasInsight: true,
            scoreDelta: -34,
            recommendedUseOverride: 'reference_only',
            needsVisualConfirmation: false,
            reasons: ['视觉观察显示这是局部特写，不适合作为 SKU 卡片主素材。'],
            warnings: []
        };
    }

    if (isGroup) {
        return {
            hasInsight: true,
            scoreDelta: -28,
            recommendedUseOverride: 'reference_only',
            needsVisualConfirmation: false,
            reasons: ['视觉观察显示这是多只合照，更适合作为款式参考。'],
            warnings: []
        };
    }

    if (isHandheld || isSceneOnly) {
        return {
            hasInsight: true,
            scoreDelta: -24,
            recommendedUseOverride: 'reference_only',
            needsVisualConfirmation: false,
            reasons: ['视觉观察显示这是场景或手持图，更适合作为款式参考。'],
            warnings: []
        };
    }

    if (isUsableSingle) {
        return {
            hasInsight: true,
            scoreDelta: 18,
            needsVisualConfirmation: false,
            reasons: ['视觉观察显示主体完整，适合 SKU 卡片置入。'],
            warnings: []
        };
    }

    if (hasProductMainSignal) {
        return {
            hasInsight: true,
            scoreDelta: 8,
            needsVisualConfirmation: true,
            reasons: ['视觉观察显示是商品主图，但还没有明确满足单色 SKU 色卡源标准。'],
            warnings: ['需要继续确认是否为单只/单双完整主体，且适合统一做成 SKU 色卡。']
        };
    }

    return {
        hasInsight: true,
        scoreDelta: 3,
        needsVisualConfirmation: true,
        reasons: ['已有画面观察，可优先复核。'],
        warnings: ['视觉观察没有明确说明是否为完整单只主素材。']
    };
}

function scoreAsset(
    asset: ProjectAssetIndexAsset,
    visualInsightLookup: Map<string, ProjectVisualInsight>,
    folderSequenceSignals: Map<string, FolderSequenceSignal>
): SkuCardAssetCandidate | null {
    if (!asset.isImage || asset.isOutput) return null;

    const reasons: string[] = [];
    const warnings: string[] = [];
    const hasFlatLayPathHint = hasPathHint(asset, '平铺');
    const folderSequenceSignal = folderSequenceSignals.get(parentPath(asset.relativePath || asset.path));
    const visualInsight = findVisualInsight(asset, visualInsightLookup);
    const visualInsightEvaluation = evaluateVisualInsightForSkuCard(visualInsight, {
        hasSkuSequenceSignal: folderSequenceSignal?.nestedFlatLayFolder === true
    });
    const canUseUnknownWithObservation = asset.role === 'unknown'
        && (hasFlatLayPathHint || visualInsightEvaluation.hasInsight);
    let score = roleBaseScore(asset.role);
    if (score <= 0) {
        if (!canUseUnknownWithObservation) return null;
        score = 44;
        warnings.push('项目索引未给出明确素材角色，本候选仅因平铺路径或画面观察进入复核。');
    }

    if (hasFlatLayPathHint) {
        score += 18;
        reasons.push('平铺素材更适合 SKU 卡片选图。');
    }
    if (folderSequenceSignal?.nestedFlatLayFolder) {
        score += 10;
        reasons.push(`同一平铺子目录中有 ${folderSequenceSignal.squareFlatLayImageCount} 张方图，适合优先做 SKU 色卡视觉确认。`);
    }
    if (hasPathHint(asset, '模特')) {
        score -= 16;
        reasons.push('模特图更适合主图或详情页，SKU 卡片中只作为参考。');
    }

    const aspectScore = squareScore(asset);
    score += aspectScore;
    if (aspectScore > 0) reasons.push('图片比例适合卡片裁切。');
    if (aspectScore < 0) warnings.push('图片比例可能需要较大裁切。');

    score += visualInsightEvaluation.scoreDelta;
    reasons.push(...visualInsightEvaluation.reasons);
    warnings.push(...visualInsightEvaluation.warnings);

    score += Math.round(Number(asset.confidence || 0) * 6);

    const recommendedUse = visualInsightEvaluation.recommendedUseOverride || recommendedUseFromScore(asset.role, score);
    if (recommendedUse === 'reject') {
        warnings.push('当前素材观察不足，不建议作为 SKU 卡片主素材。');
    }

    return {
        assetId: asset.id,
        path: asset.path,
        relativePath: asset.relativePath,
        role: asset.role,
        score,
        recommendedUse,
        needsVisualConfirmation: visualInsightEvaluation.needsVisualConfirmation ?? recommendedUse !== 'reject',
        visualObservationStatus: visualInsight ? 'matched_insight' : 'missing_insight',
        skuColorName: inferSkuColorName(visualInsight),
        reasons,
        warnings
    };
}

export function buildSkuCardAssetCandidateReport(
    input: BuildSkuCardAssetCandidateReportInput
): SkuCardAssetCandidateReport {
    const maxCandidates = Math.max(1, Math.min(12, Number(input.maxCandidates || 8)));
    const assets = Array.isArray(input.assetIndex?.assets) ? input.assetIndex.assets : [];
    const visualInsightLookup = buildVisualInsightLookup(input.visualInsightCache);
    const folderSequenceSignals = buildFolderSequenceSignals(assets);
    const candidates = assets
        .map((asset) => scoreAsset(asset, visualInsightLookup, folderSequenceSignals))
        .filter((item): item is SkuCardAssetCandidate => Boolean(item))
        .filter((item) => item.recommendedUse !== 'reject')
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return normalizePath(left.relativePath).localeCompare(normalizePath(right.relativePath), 'zh-Hans-CN');
        })
        .slice(0, maxCandidates);

    const blockers = candidates.length === 0 ? ['项目素材中没有识别到适合 SKU 卡片的候选图。'] : [];
    const needsVisual = candidates.some((candidate) => candidate.needsVisualConfirmation && candidate.recommendedUse !== 'reference_only');
    const visualInsightCoverage: SkuCardVisualInsightCoverage = {
        totalCacheEntries: Number(input.visualInsightCache?.summary?.totalEntries || 0),
        entriesWithInsight: Number(input.visualInsightCache?.summary?.entriesWithInsight || 0),
        selectedCandidateCount: candidates.length,
        matchedCandidateCount: candidates.filter((candidate) => candidate.visualObservationStatus === 'matched_insight').length,
        candidatesNeedingConfirmation: candidates.filter((candidate) => (
            candidate.needsVisualConfirmation && candidate.recommendedUse !== 'reference_only'
        )).length
    };
    const warnings = [
        needsVisual ? 'SKU 卡片候选仍需视觉模型或人工确认主体完整度、颜色清晰度和裁切风险。' : '',
        visualInsightCoverage.entriesWithInsight > 0 && visualInsightCoverage.matchedCandidateCount === 0
            ? '已有视觉缓存没有命中当前 SKU 候选，可能是素材移动、重命名或缓存过期，需要刷新候选视觉确认。'
            : ''
    ].filter(Boolean);

    return {
        version: 'sku-card-asset-candidates/v0',
        mode: 'card-style',
        status: blockers.length > 0
            ? 'blocked_no_candidates'
            : needsVisual
                ? 'needs_visual_confirmation'
                : 'ready_for_selection',
        candidateCount: candidates.length,
        candidates,
        visualInsightCoverage,
        blockers,
        warnings,
        limitations: [
            'SKU card candidate report uses metadata, path hints and existing cached observations only.',
            '候选报告不读取图片像素，不调用 Photoshop，不声明最终设计质量。',
            '纯色背景 SKU 色卡精修不属于当前卡片式候选选择范围。'
        ]
    };
}
