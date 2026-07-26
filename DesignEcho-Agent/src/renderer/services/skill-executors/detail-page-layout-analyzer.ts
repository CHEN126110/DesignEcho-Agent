import type { DetailGapMetric, DetailScreenLayoutGraph } from './detail-page-layout-graph';

export type DetailLayoutRiskMode = 'stable' | 'watch' | 'risky';

export interface DetailScreenLayoutAssessment {
    screenId: number;
    screenName: string;
    screenType: string;
    score: number;
    mode: DetailLayoutRiskMode;
    warnings: string[];
    metrics: {
        density: number;
        balanceScore: number;
        imageAreaRatio: number;
        copyAreaRatio: number;
        alignmentGroupCount: number;
        verticalGapVariation: number;
    };
}

export interface DetailLayoutAssessment {
    score: number;
    mode: DetailLayoutRiskMode;
    warnings: string[];
    riskyScreenIds: number[];
    riskyScreenNames: string[];
    screenAssessments: DetailScreenLayoutAssessment[];
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function getVerticalGapVariation(gaps: DetailGapMetric[]): number {
    const values = gaps
        .filter((gap) => gap.axis === 'vertical' && gap.normalizedGap > 0)
        .map((gap) => gap.normalizedGap);
    if (values.length <= 1) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (mean <= 0.0001) return 0;
    const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    return std / mean;
}

function assessOneGraph(graph: DetailScreenLayoutGraph): DetailScreenLayoutAssessment {
    const warnings: string[] = [];
    const alignmentGroupCount = graph.alignmentGroups.length;
    const verticalGapVariation = getVerticalGapVariation(graph.gaps);

    let score = 1;

    if (graph.density > 0.82) {
        warnings.push('元素密度过高，屏内可能过挤');
        score -= 0.22;
    } else if (graph.density < 0.08 && graph.nodeCount >= 2) {
        warnings.push('元素密度偏低，画面可能过空');
        score -= 0.1;
    }

    if (graph.balanceScore < 0.52) {
        warnings.push('视觉重心偏移明显');
        score -= 0.18;
    } else if (graph.balanceScore < 0.66) {
        warnings.push('视觉重心略不稳定');
        score -= 0.08;
    }

    if (graph.nodeCount >= 3 && alignmentGroupCount === 0) {
        warnings.push('缺少明显对齐关系');
        score -= 0.16;
    } else if (graph.nodeCount >= 4 && alignmentGroupCount === 1) {
        warnings.push('对齐关系偏弱');
        score -= 0.08;
    }

    if (verticalGapVariation > 1.1) {
        warnings.push('纵向间距波动过大');
        score -= 0.14;
    } else if (verticalGapVariation > 0.65) {
        warnings.push('纵向间距不够稳定');
        score -= 0.07;
    }

    if (graph.copyAreaRatio > 0.48) {
        warnings.push('文案区占比过高');
        score -= 0.08;
    }

    if (graph.imageAreaRatio > 0 && graph.imageAreaRatio < 0.12) {
        warnings.push('图片区占比偏小');
        score -= 0.08;
    }

    const normalized = clampScore(score);
    let mode: DetailLayoutRiskMode = 'stable';
    if (normalized < 0.48 || warnings.length >= 3) {
        mode = 'risky';
    } else if (normalized < 0.74 || warnings.length > 0) {
        mode = 'watch';
    }

    return {
        screenId: graph.screenId,
        screenName: graph.screenName,
        screenType: graph.screenType,
        score: normalized,
        mode,
        warnings,
        metrics: {
            density: graph.density,
            balanceScore: graph.balanceScore,
            imageAreaRatio: graph.imageAreaRatio,
            copyAreaRatio: graph.copyAreaRatio,
            alignmentGroupCount,
            verticalGapVariation
        }
    };
}

export function analyzeDetailPageLayout(graphs: DetailScreenLayoutGraph[]): DetailLayoutAssessment {
    const screenAssessments = (graphs || []).map(assessOneGraph);
    const riskyScreens = screenAssessments.filter((screen) => screen.mode === 'risky');
    const watchScreens = screenAssessments.filter((screen) => screen.mode === 'watch');

    const averageScore = screenAssessments.length > 0
        ? screenAssessments.reduce((sum, screen) => sum + screen.score, 0) / screenAssessments.length
        : 0;

    const warnings: string[] = [];
    if (riskyScreens.length > 0) {
        warnings.push(`${riskyScreens.length} 屏存在明显版式风险`);
    }
    if (watchScreens.length > 0) {
        warnings.push(`${watchScreens.length} 屏需要继续关注间距或重心`);
    }

    let mode: DetailLayoutRiskMode = 'stable';
    if (riskyScreens.length > 0 || averageScore < 0.5) {
        mode = 'risky';
    } else if (watchScreens.length > 0 || averageScore < 0.74) {
        mode = 'watch';
    }

    return {
        score: clampScore(averageScore),
        mode,
        warnings,
        riskyScreenIds: riskyScreens.map((screen) => screen.screenId),
        riskyScreenNames: riskyScreens.map((screen) => screen.screenName),
        screenAssessments
    };
}
