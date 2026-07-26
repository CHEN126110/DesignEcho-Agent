import type { MinimalDesignRepresentation } from '../../../shared/reference-replication';
import type { TemplateBlueprintScreen } from '../../../shared/reference-replication-blueprint';
import type { ReferenceReplicationOutputTopology } from '../../../shared/reference-replication-output-intent';
import {
    analyzeReferenceStyleRecipes,
    formatReferenceStyleRecipeAnalysisForQa
} from '../../../shared/reference-replication-style-recipes';
import {
    buildReferenceReplicationVisualQaReport,
    type ReferenceReplicationVisualQaReport,
    type ReferenceVisualQaItem
} from '../../../shared/reference-replication-visual-qa';
import type { GeneratedTemplateScreen } from './layout-replication-apply';
import type { StyleRecipeApplicationStats } from './layout-replication-apply';
import type { MatchResult } from './layout-replication-match';
import type { ReferenceElementCoverageReport } from './layout-replication-coverage';

export type ReferenceReplicationQaStage =
    | 'parsed'
    | 'template-blueprint'
    | 'template-applied'
    | 'matched';

export interface ReferenceReplicationQaDimension {
    key: 'structure' | 'placement' | 'textHierarchy' | 'editability' | 'overall';
    label: string;
    score: number | null;
    status: 'good' | 'watch' | 'risk' | 'unscored' | 'not-applicable';
    reason: string;
}

export interface ReferenceReplicationQaReport {
    stage: ReferenceReplicationQaStage;
    summary: string;
    needsReview: boolean;
    dimensions: {
        structure: ReferenceReplicationQaDimension;
        placement: ReferenceReplicationQaDimension;
        textHierarchy: ReferenceReplicationQaDimension;
        editability: ReferenceReplicationQaDimension;
        overall: ReferenceReplicationQaDimension;
    };
    checks: string[];
    observations: string[];
    limitations: string[];
    visualQa?: ReferenceReplicationVisualQaReport;
}

function clamp01(value: number, fallback = 0): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
}

function roundScore(value: number | null): number | null {
    if (value === null) return null;
    return Math.round(clamp01(value) * 100) / 100;
}

function toStatus(score: number | null): ReferenceReplicationQaDimension['status'] {
    if (score === null) return 'not-applicable';
    if (score >= 0.75) return 'good';
    if (score >= 0.45) return 'watch';
    return 'risk';
}

function createDimension(
    key: ReferenceReplicationQaDimension['key'],
    label: string,
    score: number | null,
    reason: string
): ReferenceReplicationQaDimension {
    if (score === null) {
        return {
            key,
            label,
            score: null,
            status: key === 'overall' ? 'unscored' : 'not-applicable',
            reason
        };
    }

    return {
        key,
        label,
        score: roundScore(score),
        status: toStatus(score),
        reason
    };
}

function average(scores: Array<number | null>): number | null {
    const valid = scores.filter((score): score is number => typeof score === 'number');
    if (valid.length === 0) return null;
    return valid.reduce((sum, score) => sum + score, 0) / valid.length;
}

function collectTextStats(representation?: MinimalDesignRepresentation | null): {
    textCount: number;
    uniqueRoles: number;
    primaryTextCount: number;
} {
    const elements = Array.isArray(representation?.elements) ? representation.elements : [];
    const textElements = elements.filter((element) => element.nodeKind === 'text');
    const uniqueRoles = new Set(textElements.map((element) => element.role).filter(Boolean)).size;
    const primaryTextCount = textElements.filter((element) => element.visualWeight === 'primary').length;
    return {
        textCount: textElements.length,
        uniqueRoles,
        primaryTextCount
    };
}

function collectStyleStats(representation?: MinimalDesignRepresentation | null): {
    styledElementCount: number;
    colorElementCount: number;
    effectElementCount: number;
} {
    const elements = Array.isArray(representation?.elements) ? representation.elements : [];
    const styled = elements.filter((element) => !!element.style);
    return {
        styledElementCount: styled.length,
        colorElementCount: styled.filter((element) => !!element.style?.fillColor || !!element.style?.textColor || !!element.style?.strokeColor).length,
        effectElementCount: styled.filter((element) => Array.isArray(element.style?.effects) && element.style!.effects.length > 0).length
    };
}

function scoreStructure(input: {
    representation?: MinimalDesignRepresentation | null;
    blueprintScreens?: TemplateBlueprintScreen[];
    outputTopology?: ReferenceReplicationOutputTopology;
}): ReferenceReplicationQaDimension {
    const elementCount = Array.isArray(input.representation?.elements) ? input.representation!.elements.length : 0;
    const screenCount = Array.isArray(input.blueprintScreens) ? input.blueprintScreens.length : 0;
    const hasLayoutType = String(input.representation?.layout?.layoutType || '').trim().length > 0;
    const alignmentGroupCount = Array.isArray(input.representation?.alignmentGroups) ? input.representation!.alignmentGroups.length : 0;

    if (elementCount === 0) {
        return createDimension('structure', '结构', 0, '当前没有可用于复核的元素表示。');
    }

    const normalizedScreenScore = input.outputTopology === 'single_canvas'
        ? (screenCount === 1 ? 1 : 0)
        : clamp01(screenCount > 0 ? screenCount / Math.max(1, Math.ceil(elementCount / 2)) : 0);
    const score = clamp01(
        0.45
        + normalizedScreenScore * 0.2
        + (hasLayoutType ? 0.15 : 0)
        + (alignmentGroupCount > 0 ? 0.1 : 0)
        + (screenCount > 0 ? 0.1 : 0)
    );

    const reason = screenCount > 0
        ? `已解析 ${elementCount} 个元素，并形成 ${screenCount} 个版面单元。`
        : `已解析 ${elementCount} 个元素，但尚未形成版面结构。`;

    return createDimension('structure', '结构', score, reason);
}

function scorePlacement(input: {
    blueprintScreens?: TemplateBlueprintScreen[];
    generatedScreens?: GeneratedTemplateScreen[];
    visualQa?: ReferenceReplicationVisualQaReport | null;
}): ReferenceReplicationQaDimension {
    const blueprintImageCount = (input.blueprintScreens || []).reduce((sum, screen) => (
        sum + screen.elements.filter((element) => element.role === 'image' || element.role === 'background' || element.role === 'decoration').length
    ), 0);
    const generatedPlaceholders = (input.generatedScreens || []).flatMap((screen) => screen.imagePlaceholders || []);
    const generatedImageCount = generatedPlaceholders.length;
    const placementPlanCount = generatedPlaceholders.filter((placeholder) => !!placeholder.placementPlan).length;

    if (blueprintImageCount === 0 && generatedImageCount === 0) {
        return createDimension('placement', '落位', null, '当前结果中没有图片槽位，未进行该项评分。');
    }

    if (generatedImageCount === 0) {
        return createDimension('placement', '落位', 0.32, `已识别 ${blueprintImageCount} 个图片槽位，但还没有文档落地产物。`);
    }

    const coverage = generatedImageCount > 0 ? placementPlanCount / generatedImageCount : 0;
    const visualScore = input.visualQa?.score;
    const score = typeof visualScore === 'number'
        ? clamp01((0.4 + coverage * 0.6) * 0.55 + visualScore * 0.45)
        : clamp01(0.24 + coverage * 0.2);
    const visualText = input.visualQa && input.visualQa.counts.total > 0
        ? `；视觉 bounds QA ${input.visualQa.counts.ok}/${input.visualQa.counts.total} 通过`
        : '；未获得真实视觉 QA 结果，仅记录计划覆盖率';
    return createDimension(
        'placement',
        '落位',
        score,
        `已生成 ${generatedImageCount} 个图片占位，其中 ${placementPlanCount} 个带有 placementPlan${visualText}。`
    );
}

function scoreTextHierarchy(input: {
    representation?: MinimalDesignRepresentation | null;
    generatedScreens?: GeneratedTemplateScreen[];
}): ReferenceReplicationQaDimension {
    const { textCount, uniqueRoles, primaryTextCount } = collectTextStats(input.representation);
    const copyPlaceholderCount = (input.generatedScreens || []).reduce((sum, screen) => sum + screen.copyPlaceholders.length, 0);

    if (textCount === 0 && copyPlaceholderCount === 0) {
        return createDimension('textHierarchy', '文案层级', null, '当前结果中没有文字元素，未进行该项评分。');
    }

    const score = clamp01(
        0.35
        + clamp01(textCount / 6) * 0.25
        + clamp01(uniqueRoles / 3) * 0.2
        + clamp01(primaryTextCount / 1) * 0.1
        + clamp01(copyPlaceholderCount / Math.max(1, textCount || copyPlaceholderCount)) * 0.1
    );

    return createDimension(
        'textHierarchy',
        '文案层级',
        score,
        `已识别 ${textCount} 个文字元素，角色分布 ${uniqueRoles} 类，文档中生成 ${copyPlaceholderCount} 个文字占位。`
    );
}

function scoreEditability(input: {
    generatedScreens?: GeneratedTemplateScreen[];
    applyStats?: {
        createdLayers?: number;
        failedOps?: number;
        screenCount?: number;
        styleRecipeStats?: StyleRecipeApplicationStats;
    };
    matchResult?: MatchResult | null;
    matchExecution?: {
        successCount?: number;
        failCount?: number;
    };
}): ReferenceReplicationQaDimension {
    const generatedScreens = input.generatedScreens || [];
    const createdLayers = Number(input.applyStats?.createdLayers || 0);
    const failedOps = Number(input.applyStats?.failedOps || 0);
    const screenCount = Number(input.applyStats?.screenCount || 0);
    const matchCount = Array.isArray(input.matchResult?.matches) ? input.matchResult!.matches!.length : 0;
    const matchSuccessCount = Number(input.matchExecution?.successCount || 0);
    const matchFailCount = Number(input.matchExecution?.failCount || 0);

    if (createdLayers > 0 || generatedScreens.length > 0) {
        const score = clamp01(
            0.45
            + clamp01(createdLayers / Math.max(1, screenCount * 3 || createdLayers)) * 0.25
            + clamp01(generatedScreens.length / Math.max(1, screenCount || generatedScreens.length)) * 0.2
            + (failedOps === 0 ? 0.1 : 0)
        );
        return createDimension(
            'editability',
            '可编辑性',
            score,
            `模板已落地 ${generatedScreens.length} 个版面单元，创建 ${createdLayers} 个图层，失败/跳过 ${failedOps} 次。`
        );
    }

    if (matchCount > 0) {
        const successRatio = clamp01(matchSuccessCount / Math.max(1, matchCount));
        const score = clamp01(0.35 + successRatio * 0.55 + (matchFailCount === 0 ? 0.1 : 0));
        return createDimension(
            'editability',
            '可编辑性',
            score,
            `匹配计划共 ${matchCount} 项，成功执行 ${matchSuccessCount} 项，失败/跳过 ${matchFailCount} 项。`
        );
    }

    return createDimension('editability', '可编辑性', 0.22, '当前只有结构结果，还没有实际执行到 Photoshop 文档。');
}

export function buildVisualQaItemsFromGeneratedScreens(generatedScreens?: GeneratedTemplateScreen[]): ReferenceVisualQaItem[] {
    const items: ReferenceVisualQaItem[] = [];
    for (const screen of generatedScreens || []) {
        for (const placeholder of screen.copyPlaceholders || []) {
            items.push({
                id: String(placeholder.layerId || placeholder.layerName),
                label: `${screen.name}/${placeholder.layerName}`,
                kind: 'text',
                plannedBox: placeholder.bounds,
                actualBox: placeholder.actualBounds
            });
        }
        for (const placeholder of screen.imagePlaceholders || []) {
            items.push({
                id: String(placeholder.layerId || placeholder.layerName),
                label: `${screen.name}/${placeholder.layerName}`,
                kind: placeholder.recommendedAssetType,
                plannedBox: placeholder.bounds,
                actualBox: placeholder.actualBounds
            });
        }
    }
    return items;
}

export function buildReferenceReplicationQaReport(input: {
    stage: ReferenceReplicationQaStage;
    representation?: MinimalDesignRepresentation | null;
    blueprintScreens?: TemplateBlueprintScreen[];
    outputTopology?: ReferenceReplicationOutputTopology;
    generatedScreens?: GeneratedTemplateScreen[];
    applyStats?: {
        createdLayers?: number;
        failedOps?: number;
        screenCount?: number;
        styleRecipeStats?: StyleRecipeApplicationStats;
    };
    matchResult?: MatchResult | null;
    matchExecution?: {
        successCount?: number;
        failCount?: number;
    };
    autoFillStats?: {
        filledScreens?: number;
        failedScreens?: number;
        guardedScreens?: number;
        filledImages?: number;
    };
    coverage?: ReferenceElementCoverageReport;
    visualQa?: ReferenceReplicationVisualQaReport;
}): ReferenceReplicationQaReport {
    const visualQa = input.visualQa || (
        input.stage === 'template-applied'
            ? buildReferenceReplicationVisualQaReport({
                items: buildVisualQaItemsFromGeneratedScreens(input.generatedScreens),
                snapshotObservation: { source: 'bounds-only', snapshotCount: 0, overlayCount: 0 }
            })
            : undefined
    );

    const structure = scoreStructure({
        representation: input.representation,
        blueprintScreens: input.blueprintScreens,
        outputTopology: input.outputTopology
    });
    const placement = scorePlacement({
        blueprintScreens: input.blueprintScreens,
        generatedScreens: input.generatedScreens,
        visualQa
    });
    const textHierarchy = scoreTextHierarchy({
        representation: input.representation,
        generatedScreens: input.generatedScreens
    });
    const editability = scoreEditability({
        generatedScreens: input.generatedScreens,
        applyStats: input.applyStats,
        matchResult: input.matchResult,
        matchExecution: input.matchExecution
    });
    const overallScore = average([
        structure.score,
        placement.score,
        textHierarchy.score,
        editability.score
    ]);
    const overall = createDimension(
        'overall',
        '总体',
        overallScore,
        overallScore === null
            ? '当前缺少足够检查信息进行总体评分。'
            : `总体评分基于结构、落位、文案层级、可编辑性四项启发式汇总。`
    );

    const checks: string[] = [];
    const observations: string[] = [];
    const limitations = [
        '当前 QA 评分是结构化启发式复核，不是像素级相似度评测。',
        '当前报告不代表最终设计质量，只用于说明现阶段产物是否具备继续迭代的基础。'
    ];

    const elementCount = Array.isArray(input.representation?.elements) ? input.representation!.elements.length : 0;
    const styleStats = collectStyleStats(input.representation);
    const styleRecipeAnalysis = analyzeReferenceStyleRecipes(input.representation);
    const screenCount = Array.isArray(input.blueprintScreens) ? input.blueprintScreens.length : 0;
    if (elementCount > 0) checks.push(`已解析元素 ${elementCount} 个`);
    if (styleStats.styledElementCount > 0) {
        checks.push(`已解析样式元素 ${styleStats.styledElementCount} 个，其中颜色 ${styleStats.colorElementCount} 个、效果 ${styleStats.effectElementCount} 个`);
        checks.push(...formatReferenceStyleRecipeAnalysisForQa(styleRecipeAnalysis));
        if (styleRecipeAnalysis.plannedHitCount > 0) {
            limitations.push('当前已识别部分视觉效果 recipe，但尚未执行真实 Photoshop 图层样式或滤镜。');
        }
        if (styleRecipeAnalysis.unsupportedHitCount > 0) {
            limitations.push('当前存在未归一化的模型效果描述，不能直接作为 Photoshop 执行指令。');
        }
    } else if (elementCount > 0) {
        limitations.push('当前参考图解析没有产出可用样式信息，落地结果会更接近结构骨架而不是视觉复刻。');
    }
    if (screenCount > 0) checks.push(`已生成版面单元 ${screenCount} 个`);
    if (input.coverage && input.coverage.expected > 0) {
        checks.push(`参考元素覆盖：${input.coverage.applied}/${input.coverage.expected}，失败 ${input.coverage.failed}，跳过 ${input.coverage.skipped}`);
        if (input.coverage.applied < input.coverage.expected) {
            limitations.push('参考元素覆盖不完整，当前不能视为完整复刻。');
        }
    }

    const generatedImageCount = (input.generatedScreens || []).reduce((sum, screen) => sum + screen.imagePlaceholders.length, 0);
    const generatedCopyCount = (input.generatedScreens || []).reduce((sum, screen) => sum + screen.copyPlaceholders.length, 0);
    if (generatedImageCount > 0 || generatedCopyCount > 0) {
        checks.push(`文档占位：图片 ${generatedImageCount} 个，文案 ${generatedCopyCount} 个`);
    }
    const styleRecipeStats = input.applyStats?.styleRecipeStats;
    if (styleRecipeStats && styleRecipeStats.attempted > 0) {
        checks.push(`样式 recipe 执行：尝试 ${styleRecipeStats.attempted} 项，成功 ${styleRecipeStats.applied} 项，失败 ${styleRecipeStats.failed} 项，跳过 ${styleRecipeStats.skipped} 项`);
        if (styleRecipeStats.failed > 0 || styleRecipeStats.skipped > 0) {
            limitations.push('部分样式 recipe 未执行成功，当前结果需要结合 Photoshop 图层样式和截图继续复核。');
        }
    }

    if (visualQa && visualQa.counts.total > 0) {
        checks.push(`视觉 QA 结论：${visualQa.summary}`);
        observations.push(...visualQa.observations.slice(0, 4));
        if (visualQa.status !== 'ok') {
            limitations.push(...visualQa.limitations.slice(0, 4));
        }
    } else if (input.stage === 'template-applied') {
        limitations.push('当前没有可比较的视觉 bounds QA 结果。');
    }

    if (input.autoFillStats) {
        checks.push(
            `自动填充：成功 ${Number(input.autoFillStats.filledScreens || 0)} 个版面单元，失败 ${Number(input.autoFillStats.failedScreens || 0)} 个，保护 ${Number(input.autoFillStats.guardedScreens || 0)} 个`
        );
    }

    if (input.stage === 'template-blueprint' || input.stage === 'parsed') {
        limitations.push('当前阶段尚未对 Photoshop 成品做像素级回看。');
    }
    if (input.stage === 'template-applied' && !input.autoFillStats) {
        limitations.push('当前未包含素材填充后的结果复核。');
    }
    if (input.stage === 'matched') {
        limitations.push('当前匹配结果反映的是已有图层调整，不代表完整模板重建质量。');
    }

    const needsReview = [
        structure,
        placement,
        textHierarchy,
        editability,
        overall
    ].some((dimension) => dimension.status === 'risk' || dimension.status === 'unscored');

    return {
        stage: input.stage,
        summary: overall.score === null
            ? '当前 QA 信息不足，建议继续补执行与手测。'
            : `QA 总体评分 ${overall.score.toFixed(2)}，当前${needsReview ? '建议复核' : '可继续推进'}。`,
        needsReview,
        dimensions: {
            structure,
            placement,
            textHierarchy,
            editability,
            overall
        },
        checks,
        observations,
        limitations,
        visualQa
    };
}
