import type {
    ProjectVisualSamplingCandidate,
    ProjectVisualSamplingPlan
} from './project-visual-sampling';
import type {
    SkuCardAssetCandidate,
    SkuCardAssetCandidateReport
} from './sku-card-asset-candidates';

export interface BuildSkuCardVisualConfirmationPlanInput {
    skuCardAssetCandidateReport?: SkuCardAssetCandidateReport | null;
    maxCandidates?: number;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function cleanPath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/');
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function normalizeMaxCandidates(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 8;
    return Math.max(1, Math.min(8, parsed));
}

function shouldConfirmCandidate(candidate: SkuCardAssetCandidate): boolean {
    return Boolean(cleanPath(candidate.path))
        && candidate.needsVisualConfirmation === true
        && (candidate.recommendedUse === 'primary_sku_card' || candidate.recommendedUse === 'secondary_sku_card');
}

function candidateReason(candidate: SkuCardAssetCandidate): string {
    const reasons = Array.isArray(candidate.reasons) ? candidate.reasons.map(cleanString).filter(Boolean) : [];
    return [
        `SKU 卡片候选 ${cleanPath(candidate.relativePath || candidate.path)} 需要视觉确认。`,
        ...reasons.slice(0, 3)
    ].join(' ');
}

function toVisualSamplingCandidate(
    candidate: SkuCardAssetCandidate,
    index: number
): ProjectVisualSamplingCandidate {
    const path = cleanPath(candidate.path);
    const cacheSource = [
        candidate.assetId,
        path,
        candidate.role,
        candidate.score
    ].map(cleanString).join('|');

    return {
        assetId: cleanString(candidate.assetId),
        path,
        role: candidate.role,
        priority: Math.max(1, 100 - index),
        score: Number(candidate.score || 0),
        reason: candidateReason(candidate),
        cacheKey: `sku-card-visual:${stableHash(cacheSource)}`,
        cacheStatus: 'miss',
        shouldAnalyze: true,
        requiredObservations: [
            '必须确认主体是不是完整单只/平铺素材。',
            '必须确认是否存在局部特写、多只合照、模特穿着或成品图误用。',
            '必须确认裁切风险、颜色清晰度和 SKU 卡片可用性。'
        ],
        selectionNotes: [{
            source: path,
            summary: `${path} selected for SKU card visual confirmation.`
        }]
    };
}

export function buildSkuCardVisualConfirmationPlan(
    input: BuildSkuCardVisualConfirmationPlanInput
): ProjectVisualSamplingPlan {
    const report = input.skuCardAssetCandidateReport || null;
    const maxCandidates = normalizeMaxCandidates(input.maxCandidates);
    const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
    const confirmCandidates = candidates.filter(shouldConfirmCandidate);
    const selectedCandidates = confirmCandidates
        .slice(0, maxCandidates)
        .map(toVisualSamplingCandidate);
    const skippedCandidateCount = Math.max(0, confirmCandidates.length - selectedCandidates.length);
    const matchedCandidateCount = Number(report?.visualInsightCoverage?.matchedCandidateCount || 0);
    const entriesWithInsight = Number(report?.visualInsightCoverage?.entriesWithInsight || 0);

    return {
        planVersion: 'project-visual-sampling/v0',
        mode: 'bounded-metadata-plan',
        scenario: 'sku',
        maxCandidates,
        selectedCandidates,
        skippedCandidateCount,
        cacheSummary: {
            hit: 0,
            miss: selectedCandidates.length,
            stale: 0,
            shouldAnalyze: selectedCandidates.length
        },
        warnings: [
            selectedCandidates.length === 0 ? '当前没有需要 SKU 卡片视觉确认的候选。' : '',
            entriesWithInsight > 0 && matchedCandidateCount === 0
                ? '已有视觉缓存没有命中当前 SKU 候选，本轮应刷新候选视觉确认。'
                : ''
        ].filter(Boolean),
        limitations: [
            '该计划只选择少量待确认候选，不调用视觉模型、不写缓存、不写 Photoshop 文档。',
            '视觉确认结果只表示已形成素材观察，不代表最终 SKU 卡片排版质量通过。',
            '同名文件或移动文件不会被自动当成已确认素材，必须重新命中 assetId/path 或刷新画面观察。'
        ],
        sourceRecords: selectedCandidates.flatMap((candidate) => candidate.selectionNotes)
    };
}
