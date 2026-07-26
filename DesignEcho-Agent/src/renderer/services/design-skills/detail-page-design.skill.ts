import type { DetailScreenPlan, FillPlan, LayerIssue, ParsedScreen } from '../skill-executors/detail-page.types';
import type { DetailScreenRole } from '../../../shared/detail-page-screen-plan';
import type { DesignProjectState } from '../../../shared/types/design-project-state.types';
import type { ProjectVisualInsightCacheReadResult } from '../../../shared/project-visual-insight-cache';

import { buildSelectedDesignContext } from '../../../shared/design-selected-design-context';
import { buildSelectedElementContext } from '../../../shared/design-selected-element-context';
import { buildSelectedModuleContext } from '../../../shared/design-selected-module-context';
import {
    buildDetailPageStateContext,
    type DetailPageStateContext
} from '../../../shared/detail-page-state-consumption';
import type { DesignScene } from '../../../shared/types/design-context.types';
import type { SelectedElementContext } from '../../../shared/types/design-scene.types';
import type { SelectedModuleContext } from '../../../shared/types/design-graph.types';
import type { SelectedDesignContext } from '../../../shared/types/design-context.types';
import {
    alignDetailFillPlansToScreens,
    analyzeDetailImageAnchors,
    analyzeDetailPlaceholderAnchors,
    calculateDetailPlanQuality,
    collectDetailStructureAlerts,
    enrichDetailFillPlansWithLayerRelations
} from '../skill-executors/detail-page-plan-utils';
import {
    applyDetailFillPlanCopiesToScreens,
    auditDetailCopyLayoutForScreens as auditDetailCopyLayout
} from '../../../shared/detail-page-copy-layout-audit';
import {
    normalizeDetailFlatLayers,
    reconstructDetailPlacementsFromHierarchy
} from '../../../shared/detail-page-live-placement';
import {
    auditDetailSegmentationMerge,
    buildDetailScreenVisualSummaries,
    buildDetailVisualModules,
    buildDetailVisualScreenBoundaries,
    type DetailSegmentationMergeAudit,
    type DetailVisualModule,
    type DetailVisualScreenBoundary,
    type DetailScreenVisualSummary
} from '../../../shared/detail-page-visual-segmentation';
import { assessDetailPageTemplateReadiness } from '../skill-executors/detail-page-template-readiness';
import { buildDetailPageLayoutGraphs } from '../skill-executors/detail-page-layout-graph';
import { analyzeDetailPageLayout } from '../skill-executors/detail-page-layout-analyzer';
import { applyDetailImageFitDecisions } from '../skill-executors/detail-page-image-fit';
import { describeDetailScreenRole, inferDetailScreenPlans } from '../skill-executors/detail-page-screen-role';

type DetailToolRunner = (toolName: string, params: Record<string, any>) => Promise<any>;

export type DetailVisualPlanningContext = {
    visualSummaries: DetailScreenVisualSummary[];
    mergeStatus: 'ok' | 'watch' | 'risky';
    visualScreenCount: number;
    visualModuleCount: number;
    warnings: string[];
    documentInfo: Record<string, unknown> | null;
    flatLayers: Array<Record<string, unknown>>;
    visualScreens: DetailVisualScreenBoundary[];
    visualModules: DetailVisualModule[];
    mergeAudit: DetailSegmentationMergeAudit;
};

export type DetailFocusContext = {
    selectedDesignContext: SelectedDesignContext | null;
    selectedScene: DesignScene | null;
    selectedElementContext: SelectedElementContext | null;
    selectedModuleContext: SelectedModuleContext | null;
    focusedScreenId: number | null;
    focusedScreenName: string | null;
    focusedScreenRole: string | null;
    focusedVisualModuleId: string | null;
    focusedModuleInferenceMode: SelectedModuleContext['diagnostics']['inferenceMode'] | null;
};

export type DetailTemplateState = {
    readiness: ReturnType<typeof assessDetailPageTemplateReadiness>;
    layoutGraphs: ReturnType<typeof buildDetailPageLayoutGraphs>;
    layoutAssessment: ReturnType<typeof analyzeDetailPageLayout>;
    placeholderAnchorDiagnostics: ReturnType<typeof analyzeDetailPlaceholderAnchors>;
    visualPlanning: DetailVisualPlanningContext;
    screenPlans: DetailScreenPlan[];
    projectStateContext: DetailPageStateContext;
    templateCopyAudit: ReturnType<typeof auditDetailCopyLayout>;
    structureAlerts: ReturnType<typeof collectDetailStructureAlerts>;
    focus: DetailFocusContext;
};

export type DetailContentPlanningResult = {
    fillPlans: FillPlan[];
    projectedCopyAudit: ReturnType<typeof auditDetailCopyLayout>;
    anchorDiagnostics: ReturnType<typeof analyzeDetailImageAnchors>;
    copyGenerationSummary: {
        totalCopies: number;
        generatedCopies: number;
        templateCopies: number;
        screensWithGeneratedCopy: number;
        strategiesUsed: string[];
    };
    fitDecisionCount: number;
};

export type DetailExecutionReviewLevel = 'ok' | 'watch' | 'risky';

export type DetailPreparedScreenPlan = {
    plan: FillPlan | null;
    degraded: boolean;
    skippedRiskyImageCount: number;
    notes: string[];
    rebuilt: boolean;
};

export type DetailExecutionScopeResolution = {
    canProceed: boolean;
    failureMessage?: string;
    failureReason?: string;
    screens: ParsedScreen[];
    issues: LayerIssue[];
    crossScreenRiskCount: number;
    templateState: DetailTemplateState;
    notes: string[];
};

export function formatDetailScreenPlanLine(plan: DetailScreenPlan): string {
    const riskText = (plan.risks || []).length > 0 ? ` / 风险 ${plan.risks.length} 项` : '';
    const decisionText = plan.requiresModelDecision
        ? ' / 待模型决策'
        : ` / 决策 ${plan.decisionSource}`;
    return `${plan.screenName}: ${describeDetailScreenRole(plan.screenRole)} / 文案策略 ${plan.copyStrategy} / 图片策略 ${plan.imageStrategy}${decisionText}${riskText}`;
}

export function resolveDetailExecutionReviewLevel(params: {
    failCount: number;
    degradedScreenCount: number;
    readinessMode: ReturnType<typeof assessDetailPageTemplateReadiness>['mode'];
    layoutMode: ReturnType<typeof analyzeDetailPageLayout>['mode'];
    visualMergeStatus: DetailVisualPlanningContext['mergeStatus'];
    hasBoundaryRisk: boolean;
    anchorWarningCount: number;
    templateCopyWarningCount: number;
    liveCopyRiskyCount: number;
    liveCopyWarningCount: number;
    unmatchedPlaceholderCount: number;
    riskyPlacementCount: number;
}): DetailExecutionReviewLevel {
    const hardRisk = params.failCount > 0
        || params.liveCopyRiskyCount > 0
        || params.unmatchedPlaceholderCount > 0
        || params.riskyPlacementCount > 0;

    if (hardRisk) {
        return 'risky';
    }

    const watchRisk = params.degradedScreenCount > 0
        || params.readinessMode !== 'auto-fill'
        || params.layoutMode !== 'stable'
        || params.visualMergeStatus !== 'ok'
        || params.hasBoundaryRisk
        || params.anchorWarningCount > 0
        || params.templateCopyWarningCount > 0
        || params.liveCopyWarningCount > 0;

    return watchRisk ? 'watch' : 'ok';
}

export function buildDetailExecutionSummary(params: {
    screens: ParsedScreen[];
    screenPlans: DetailScreenPlan[];
    readiness: ReturnType<typeof assessDetailPageTemplateReadiness>;
    layoutAssessment: ReturnType<typeof analyzeDetailPageLayout>;
    visualPlanning: DetailVisualPlanningContext;
    anchorDiagnostics: ReturnType<typeof analyzeDetailImageAnchors>;
    placementAudit?: {
        warnings?: string[];
        riskyScreenIds?: number[];
    };
    copyLayoutAudit?: {
        summary?: {
            riskyCopyCount?: number;
            watchCopyCount?: number;
            warningCount?: number;
        };
        warnings?: string[];
    };
    copyGenerationSummary?: DetailContentPlanningResult['copyGenerationSummary'];
    focus?: DetailFocusContext;
    livePlacementDiagnostics?: {
        placementCount: number;
        unmatchedPlaceholderCount: number;
    };
    reviewLevel: DetailExecutionReviewLevel;
    successCount: number;
    failCount: number;
    degradedScreenNames: string[];
    phaseDurations?: Record<string, number>;
    exportResult?: any;
    totalTime: number;
}): string {
    const lines: string[] = [
        params.failCount > 0
            ? '详情页已部分执行完成，存在失败屏，需要优先复核。'
            : params.reviewLevel === 'risky'
                ? '详情页已执行完成，但结果风险较高，需要优先复核。'
                : params.reviewLevel === 'watch'
                    ? '详情页已执行完成，存在观察项。'
                    : '详情页执行完成。',
        '',
        `模板评估: ${params.readiness.mode} (${Math.round(params.readiness.score * 100)} 分)`,
        `版式评估: ${params.layoutAssessment.mode} (${Math.round(params.layoutAssessment.score * 100)} 分)`,
        `视觉分块: ${params.visualPlanning.mergeStatus}（视觉屏 ${params.visualPlanning.visualScreenCount} / 模块 ${params.visualPlanning.visualModuleCount}）`,
        `执行结果: 共 ${params.screens.length} 屏，成功 ${params.successCount} 屏，失败 ${params.failCount} 屏`
    ];

    if (params.readiness.risks.length > 0) {
        lines.push(`结构风险: ${params.readiness.risks.join('；')}`);
    }
    if (params.focus?.focusedScreenName) {
        const roleText = params.focus.focusedScreenRole
            ? ` / ${describeDetailScreenRole(params.focus.focusedScreenRole as DetailScreenRole)}`
            : '';
        lines.push(`当前关注点: ${params.focus.focusedScreenName}${roleText}`);
    }
    if (params.layoutAssessment.warnings.length > 0) {
        lines.push(`版式提示: ${params.layoutAssessment.warnings.join('；')}`);
    }
    if (params.anchorDiagnostics.warnings.length > 0) {
        lines.push(`放图风险: ${params.anchorDiagnostics.warnings.join('；')}`);
    }
    if (params.visualPlanning.warnings.length > 0) {
        lines.push(`视觉分割提示: ${params.visualPlanning.warnings.join('；')}`);
    }
    if (params.copyGenerationSummary) {
        lines.push(
            `文案生成: 共 ${params.copyGenerationSummary.totalCopies} 条，AI 生成 ${params.copyGenerationSummary.generatedCopies} 条，涉及 ${params.copyGenerationSummary.screensWithGeneratedCopy} 屏`
        );
    }
    if (params.copyLayoutAudit?.summary) {
        lines.push(
            `文案布局风险: 高风险 ${params.copyLayoutAudit.summary.riskyCopyCount || 0}，观察项 ${params.copyLayoutAudit.summary.watchCopyCount || 0}`
        );
    }
    if (params.livePlacementDiagnostics) {
        lines.push(
            `Live 放图重建: ${params.livePlacementDiagnostics.placementCount} 个已匹配，${params.livePlacementDiagnostics.unmatchedPlaceholderCount} 个占位仍未匹配`
        );
    }
    if ((params.placementAudit?.warnings?.length || 0) > 0) {
        lines.push(`落位复核: ${params.placementAudit?.warnings?.join('；')}`);
    }
    if (params.degradedScreenNames.length > 0) {
        lines.push(`受保护屏: ${params.degradedScreenNames.join('、')}`);
    }
    if (params.screenPlans.length > 0) {
        lines.push('屏规划:');
        lines.push(...params.screenPlans.map((plan) => `- ${formatDetailScreenPlanLine(plan)}`));
    }
    if (params.phaseDurations && Object.keys(params.phaseDurations).length > 0) {
        const phaseText = Object.entries(params.phaseDurations)
            .map(([name, duration]) => `${name} ${duration}ms`)
            .join('；');
        lines.push(`阶段耗时: ${phaseText}`);
    }
    if (params.exportResult?.success) {
        lines.push(`导出: 已输出 ${params.exportResult.exportedCount || 0} 张切片`);
    }
    lines.push(`总耗时: ${(params.totalTime / 1000).toFixed(1)}s`);

    return lines.join('\n');
}

export function buildDetailInspectionSummary(params: {
    screens: ParsedScreen[];
    screenPlans: DetailScreenPlan[];
    readiness: ReturnType<typeof assessDetailPageTemplateReadiness>;
    layoutAssessment: ReturnType<typeof analyzeDetailPageLayout>;
    visualPlanning: DetailVisualPlanningContext;
    focus?: DetailFocusContext;
    anchorDiagnostics: ReturnType<typeof analyzeDetailPlaceholderAnchors>;
    copyLayoutAudit?: {
        summary?: {
            riskyCopyCount?: number;
            watchCopyCount?: number;
            warningCount?: number;
        };
        warnings?: string[];
    };
    totalTime: number;
}): string {
    const lines: string[] = [
        '详情页结构检查完成。',
        '',
        `模板评估: ${params.readiness.mode} (${Math.round(params.readiness.score * 100)} 分)`,
        `版式评估: ${params.layoutAssessment.mode} (${Math.round(params.layoutAssessment.score * 100)} 分)`,
        `视觉分块: ${params.visualPlanning.mergeStatus}（视觉屏 ${params.visualPlanning.visualScreenCount} / 模块 ${params.visualPlanning.visualModuleCount}）`,
        `当前共识别 ${params.screens.length} 屏`
    ];

    if (params.readiness.risks.length > 0) {
        lines.push(`结构风险: ${params.readiness.risks.join('；')}`);
    }
    if (params.focus?.focusedScreenName) {
        const roleText = params.focus.focusedScreenRole
            ? ` / ${describeDetailScreenRole(params.focus.focusedScreenRole as DetailScreenRole)}`
            : '';
        lines.push(`当前关注点: ${params.focus.focusedScreenName}${roleText}`);
    }
    if (params.layoutAssessment.warnings.length > 0) {
        lines.push(`版式提示: ${params.layoutAssessment.warnings.join('；')}`);
    }
    if (params.anchorDiagnostics.warnings.length > 0) {
        lines.push(`锚点风险: ${params.anchorDiagnostics.warnings.join('；')}`);
    }
    if (params.visualPlanning.warnings.length > 0) {
        lines.push(`视觉分割提示: ${params.visualPlanning.warnings.join('；')}`);
    }
    if (params.copyLayoutAudit?.summary) {
        lines.push(
            `文案布局风险: 高风险 ${params.copyLayoutAudit.summary.riskyCopyCount || 0}，观察项 ${params.copyLayoutAudit.summary.watchCopyCount || 0}`
        );
    }
    if (params.screenPlans.length > 0) {
        lines.push('屏规划:');
        lines.push(...params.screenPlans.map((plan) => `- ${formatDetailScreenPlanLine(plan)}`));
    }
    lines.push(`总耗时: ${(params.totalTime / 1000).toFixed(1)}s`);

    return lines.join('\n');
}

function summarizeDetailCopyGeneration(fillPlans: FillPlan[]) {
    const totalCopies = fillPlans.reduce((sum, plan) => sum + (plan.copies?.length || 0), 0);
    const generatedCopies = fillPlans.reduce(
        (sum, plan) => sum + (plan.copies || []).filter((copy) => copy.source === 'ai_generated' || copy.generationStatus === 'generated').length,
        0
    );
    const screensWithGeneratedCopy = new Set<number>();
    const strategiesUsed = new Set<string>();

    for (const plan of fillPlans) {
        if (plan.copyStrategy) strategiesUsed.add(plan.copyStrategy);
        if ((plan.copies || []).some((copy) => copy.source === 'ai_generated' || copy.generationStatus === 'generated')) {
            screensWithGeneratedCopy.add(plan.screenId);
        }
    }

    return {
        totalCopies,
        generatedCopies,
        templateCopies: Math.max(0, totalCopies - generatedCopies),
        screensWithGeneratedCopy: screensWithGeneratedCopy.size,
        strategiesUsed: Array.from(strategiesUsed)
    };
}

function removeRiskyPlanImages(plan: FillPlan, riskyLayerIds: Set<number>): FillPlan {
    if (!riskyLayerIds.size || !Array.isArray(plan.images) || plan.images.length === 0) {
        return plan;
    }
    return {
        ...plan,
        images: plan.images.filter((image) => !riskyLayerIds.has(Number(image.layerId || 0)))
    };
}

export async function buildDetailVisualPlanningContext(params: {
    screens: ParsedScreen[];
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<DetailVisualPlanningContext> {
    const { screens, runTool, results } = params;
    const emptyMergeAudit: DetailSegmentationMergeAudit = {
        status: 'watch',
        summary: {
            parsedScreenCount: screens.length,
            visualScreenCount: 0,
            moduleCount: 0,
            lowOverlapScreenCount: 0,
            unmatchedVisualScreenCount: 0,
            modulesWithoutSourceScreenCount: 0
        },
        lowOverlapScreens: [],
        unmatchedVisualScreens: [],
        modulesWithoutSourceScreen: []
    };

    if (!Array.isArray(screens) || screens.length === 0) {
        return {
            visualSummaries: [],
            mergeStatus: 'watch',
            visualScreenCount: 0,
            visualModuleCount: 0,
            warnings: ['没有可用于视觉分块的屏'],
            documentInfo: null,
            flatLayers: [],
            visualScreens: [],
            visualModules: [],
            mergeAudit: emptyMergeAudit
        };
    }

    const docInfoResult = await runTool('getDocumentInfo', {});
    results.push({ toolName: 'getDocumentInfo[detailVisualPlanning]', result: docInfoResult });
    if (!docInfoResult?.success) {
        return {
            visualSummaries: [],
            mergeStatus: 'watch',
            visualScreenCount: 0,
            visualModuleCount: 0,
            warnings: ['无法读取文档信息，视觉分块未参与本轮规划'],
            documentInfo: null,
            flatLayers: [],
            visualScreens: [],
            visualModules: [],
            mergeAudit: emptyMergeAudit
        };
    }

    const hierarchyResult = await runTool('getLayerHierarchy', { includeBounds: true, flatList: true });
    results.push({ toolName: 'getLayerHierarchy[detailVisualPlanning]', result: hierarchyResult });

    const flatLayers = normalizeDetailFlatLayers(hierarchyResult);
    const width = Math.max(0, Number(docInfoResult?.width || 0));
    const height = Math.max(0, Number(docInfoResult?.height || 0));
    if (!flatLayers.length || width <= 0 || height <= 0) {
        return {
            visualSummaries: [],
            mergeStatus: 'watch',
            visualScreenCount: 0,
            visualModuleCount: 0,
            warnings: ['文档几何信息不完整，视觉分块未参与本轮规划'],
            documentInfo: docInfoResult,
            flatLayers,
            visualScreens: [],
            visualModules: [],
            mergeAudit: emptyMergeAudit
        };
    }

    const documentBounds = { left: 0, top: 0, right: width, bottom: height, width, height };
    const visualScreens = buildDetailVisualScreenBoundaries({ screens, flatLayers, documentBounds });
    const visualModules = buildDetailVisualModules({ screens, visualScreens, flatLayers, documentBounds });
    const mergeAudit = auditDetailSegmentationMerge({ screens, visualScreens, visualModules });
    const visualSummaries = buildDetailScreenVisualSummaries({
        screens: screens as unknown as Array<Record<string, unknown>>,
        visualScreens,
        visualModules,
        mergeAudit
    });

    return {
        visualSummaries,
        mergeStatus: mergeAudit.status,
        visualScreenCount: visualScreens.length,
        visualModuleCount: visualModules.length,
        warnings: mergeAudit.lowOverlapScreens.map((item) => `${item.screenName} 的视觉边界和结构边界重合度偏低`),
        documentInfo: docInfoResult,
        flatLayers,
        visualScreens,
        visualModules,
        mergeAudit
    };
}

export async function readDetailFocusContext(params: {
    screens: ParsedScreen[];
    screenPlans: DetailScreenPlan[];
    visualPlanning: DetailVisualPlanningContext;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<DetailFocusContext> {
    const { screens, screenPlans, visualPlanning, runTool, results } = params;

    const fallback: DetailFocusContext = {
        selectedDesignContext: null,
        selectedScene: null,
        selectedElementContext: null,
        selectedModuleContext: null,
        focusedScreenId: null,
        focusedScreenName: null,
        focusedScreenRole: null,
        focusedVisualModuleId: null,
        focusedModuleInferenceMode: null
    };

    if (!visualPlanning.documentInfo || visualPlanning.flatLayers.length === 0) {
        return fallback;
    }

    const diagnoseState = await runTool('diagnoseState', { verbose: false });
    results.push({ toolName: 'diagnoseState[detailFocus]', result: diagnoseState });
    if (!diagnoseState?.success) {
        return fallback;
    }

    const state = diagnoseState?.state && typeof diagnoseState.state === 'object'
        ? diagnoseState.state as Record<string, unknown>
        : {};
    const selectedLayers = Array.isArray(state.selectedLayers)
        ? state.selectedLayers as Array<Record<string, unknown>>
        : [];
    const selectedLayerId = selectedLayers.length > 0 && typeof selectedLayers[0]?.id === 'number'
        ? Number(selectedLayers[0].id)
        : null;
    if (!selectedLayerId) {
        return fallback;
    }

    const selectedNode = visualPlanning.flatLayers.find((layer) => Number(layer?.id || 0) === selectedLayerId) || null;
    if (!selectedNode) {
        return fallback;
    }

    const propertiesPayload = await runTool('getLayerProperties', { layerId: selectedLayerId });
    results.push({ toolName: 'getLayerProperties[detailFocus]', result: propertiesPayload });
    const boundsPayload = await runTool('getLayerBounds', { layerId: selectedLayerId });
    results.push({ toolName: 'getLayerBounds[detailFocus]', result: boundsPayload });
    const clippingPayload = await runTool('getClippingMaskInfo', { layerId: selectedLayerId });
    results.push({ toolName: 'getClippingMaskInfo[detailFocus]', result: clippingPayload });

    const properties = propertiesPayload?.success ? propertiesPayload : null;
    const bounds = boundsPayload?.success ? boundsPayload : null;
    const clipping = clippingPayload?.success ? clippingPayload : null;
    const propertyRecord = properties?.properties && typeof properties.properties === 'object'
        ? properties.properties as Record<string, unknown>
        : {};
    const layerKind = String(propertyRecord.kind || selectedNode.kind || '').toLowerCase();
    const isTextLayer = layerKind.includes('text');

    let textContentPayload: Record<string, unknown> | null = null;
    let textStylePayload: Record<string, unknown> | null = null;
    if (isTextLayer) {
        const textContent = await runTool('getTextContent', { layerId: selectedLayerId });
        results.push({ toolName: 'getTextContent[detailFocus]', result: textContent });
        const textStyle = await runTool('getTextStyle', { layerId: selectedLayerId });
        results.push({ toolName: 'getTextStyle[detailFocus]', result: textStyle });
        textContentPayload = textContent?.success ? textContent : null;
        textStylePayload = textStyle?.success ? textStyle : null;
    }

    const selectedElementContext = buildSelectedElementContext({
        source: 'active-layer',
        documentInfo: visualPlanning.documentInfo,
        selectedNode: {
            ...selectedNode,
            bounds: propertyRecord.bounds || bounds?.bounds || selectedNode.bounds
        },
        flatLayers: visualPlanning.flatLayers,
        propertiesPayload: properties,
        clippingPayload: clipping,
        textContentPayload,
        textStylePayload,
        detailPayload: {
            success: true,
            screens,
            screenPlans,
            visualModules: visualPlanning.visualModules,
            audit: visualPlanning.mergeAudit
        },
        includeText: isTextLayer,
        includeDetailContext: true,
        relationLimit: 6,
        usedTools: [
            'diagnoseState',
            'getLayerProperties',
            'getLayerBounds',
            'getClippingMaskInfo',
            ...(isTextLayer ? ['getTextContent', 'getTextStyle'] : [])
        ]
    });

    const selectedModuleContext = buildSelectedModuleContext({
        selectedElementContext,
        visualModules: visualPlanning.visualModules,
        visualScreens: visualPlanning.visualScreens,
        relationLimit: 6
    });

    const selectedDesignContext: SelectedDesignContext = buildSelectedDesignContext({
        selectedElementContext,
        selectedModuleContext
    });
    const selectedScene = selectedDesignContext.scene ?? null;

    return {
        selectedDesignContext,
        selectedScene,
        selectedElementContext,
        selectedModuleContext,
        focusedScreenId: selectedScene?.selectedScreen?.sourceScreenId ?? selectedElementContext.detail?.screenId ?? null,
        focusedScreenName: selectedScene?.selectedScreen?.name ?? selectedElementContext.detail?.screenName ?? null,
        focusedScreenRole: selectedScene?.selectedScreen?.role ?? selectedElementContext.detail?.screenRole ?? null,
        focusedVisualModuleId: selectedScene?.selectedModule?.id ?? selectedElementContext.detail?.visualModuleId ?? null,
        focusedModuleInferenceMode: selectedModuleContext.diagnostics.inferenceMode
    };
}

function sortDetailScreensByFocus<T extends { id?: number; screenId?: number }>(items: T[], focusedScreenId: number | null): T[] {
    if (!focusedScreenId) return items;
    return [...items].sort((a, b) => {
        const aId = Number(a.id || a.screenId || 0);
        const bId = Number(b.id || b.screenId || 0);
        const aFocus = aId === focusedScreenId ? 1 : 0;
        const bFocus = bId === focusedScreenId ? 1 : 0;
        return bFocus - aFocus;
    });
}

export async function buildDetailTemplateState(params: {
    screens: ParsedScreen[];
    issues: LayerIssue[];
    crossScreenRiskCount: number;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
    designProjectState?: DesignProjectState | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
}): Promise<DetailTemplateState> {
    const { screens, issues, crossScreenRiskCount, runTool, results } = params;
    const readiness = assessDetailPageTemplateReadiness({
        screens,
        issues,
        crossScreenRiskCount
    });
    const layoutGraphs = buildDetailPageLayoutGraphs(screens);
    const layoutAssessment = analyzeDetailPageLayout(layoutGraphs);
    const placeholderAnchorDiagnostics = analyzeDetailPlaceholderAnchors(screens);
    const visualPlanning = await buildDetailVisualPlanningContext({
        screens,
        runTool,
        results
    });
    const projectStateContext = buildDetailPageStateContext({
        state: params.designProjectState || null,
        screens
    });
    const screenPlans = inferDetailScreenPlans(screens, layoutAssessment, {
        visualSummaries: visualPlanning.visualSummaries,
        agentDecisions: projectStateContext.agentDecisions
    });
    const templateCopyAudit = auditDetailCopyLayout({
        screens,
        screenPlans
    });
    const focus = await readDetailFocusContext({
        screens,
        screenPlans,
        visualPlanning,
        runTool,
        results
    });

    return {
        readiness,
        layoutGraphs,
        layoutAssessment,
        placeholderAnchorDiagnostics,
        visualPlanning,
        screenPlans,
        projectStateContext,
        templateCopyAudit,
        structureAlerts: collectDetailStructureAlerts(screens),
        focus
    };
}

export async function resolveDetailExecutionScope(params: {
    screens: ParsedScreen[];
    issues: LayerIssue[];
    crossScreenRiskCount: number;
    autoFix: boolean;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
    designProjectState?: DesignProjectState | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
}): Promise<DetailExecutionScopeResolution> {
    const { autoFix, runTool, results } = params;
    let screens = params.screens;
    let issues = params.issues;
    let crossScreenRiskCount = params.crossScreenRiskCount;
    const notes: string[] = [];

    let templateState = await buildDetailTemplateState({
        screens,
        issues,
        crossScreenRiskCount,
        runTool,
        results,
        designProjectState: params.designProjectState || null,
        visualInsightCache: params.visualInsightCache || null
    });

    if (autoFix) {
        const fixableIssues = issues.filter((issue) => issue.autoFixable);
        if (fixableIssues.length > 0) {
            const fixResult = await runTool('fixLayerIssues', { issues: fixableIssues });
            results.push({ toolName: 'fixLayerIssues', result: fixResult });

            const parseResult = await runTool('parseDetailPageTemplate', { includeStructure: true });
            results.push({ toolName: 'parseDetailPageTemplate[afterFix]', result: parseResult });
            if (!parseResult?.success) {
                return {
                    canProceed: false,
                    failureMessage: `自动修复后重新解析详情页失败: ${parseResult?.error || '未知错误'}`,
                    failureReason: parseResult?.error || 'Parse after fix failed',
                    screens,
                    issues,
                    crossScreenRiskCount,
                    templateState,
                    notes
                };
            }

            screens = parseResult.screens || [];
            crossScreenRiskCount = Array.isArray(parseResult.crossScreenLayers) ? parseResult.crossScreenLayers.length : 0;

            const detectResult = await runTool('detectLayerIssues', { screens });
            results.push({ toolName: 'detectLayerIssues[afterFix]', result: detectResult });
            issues = detectResult?.issues || [];

            templateState = await buildDetailTemplateState({
                screens,
                issues,
                crossScreenRiskCount,
                runTool,
                results,
                designProjectState: params.designProjectState || null,
                visualInsightCache: params.visualInsightCache || null
            });
            notes.push(`已自动修复 ${fixableIssues.length} 个结构问题`);
        }
    }

    if (templateState.readiness.mode === 'manual-assist') {
        const recoverableScreens = screens.filter((screen) => (
            (screen.copyPlaceholders?.length || 0) + (screen.imagePlaceholders?.length || 0)
        ) > 0);

        if (recoverableScreens.length === 0) {
            return {
                canProceed: false,
                failureMessage: `当前模板不适合直接全自动填充: ${templateState.readiness.risks.join('；') || '缺少稳定结构'}`,
                failureReason: 'Template requires manual assist',
                screens,
                issues,
                crossScreenRiskCount,
                templateState,
                notes
            };
        }

        if (recoverableScreens.length < screens.length) {
            notes.push(`模板结构较乱，仅保留 ${recoverableScreens.length}/${screens.length} 个可恢复屏继续执行`);
        } else {
            notes.push('模板结构不够规整，但仍存在可恢复屏，继续按可恢复策略执行');
        }

        screens = recoverableScreens;
        const detectResult = await runTool('detectLayerIssues', { screens });
        results.push({ toolName: 'detectLayerIssues[recoverable]', result: detectResult });
        issues = detectResult?.issues || [];
        templateState = await buildDetailTemplateState({
            screens,
            issues,
            crossScreenRiskCount,
            runTool,
            results,
            designProjectState: params.designProjectState || null,
            visualInsightCache: params.visualInsightCache || null
        });
    }

    return {
        canProceed: true,
        screens,
        issues,
        crossScreenRiskCount,
        templateState,
        notes
    };
}

export async function rebuildSingleDetailScreenPlan(params: {
    screen: ParsedScreen;
    screenPlan: DetailScreenPlan | undefined;
    focus?: DetailFocusContext;
    projectPath?: string;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<FillPlan | null> {
    const { screen, screenPlan, focus, projectPath, runTool, results } = params;
    const rebuildMatch = await runTool('matchDetailPageContent', {
        screens: [screen],
        projectPath,
        screenPlans: screenPlan ? [screenPlan] : [],
        selectedScene: focus?.selectedScene || undefined,
        selectedDesignContext: focus?.selectedDesignContext || undefined,
        selectedElementContext: focus?.selectedElementContext || undefined,
        selectedModuleContext: focus?.selectedModuleContext || undefined
    });
    results.push({ toolName: `matchDetailPageContent[rebuild:${screen.name}]`, result: rebuildMatch });
    if (!rebuildMatch?.success) return null;

    const enriched = enrichDetailFillPlansWithLayerRelations(rebuildMatch.plans || [], [screen]);
    const aligned = alignDetailFillPlansToScreens(enriched, [screen]);
    const singleLayoutAssessment = analyzeDetailPageLayout(buildDetailPageLayoutGraphs([screen]));
    const fitAdjusted = applyDetailImageFitDecisions(aligned.alignedPlans, [screen], singleLayoutAssessment);
    return (fitAdjusted.plans.filter(Boolean)[0] as FillPlan | undefined) || null;
}

export async function planDetailPageContent(params: {
    screens: ParsedScreen[];
    screenPlans: DetailScreenPlan[];
    focus?: DetailFocusContext;
    projectPath?: string;
    layoutAssessment: ReturnType<typeof analyzeDetailPageLayout>;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<DetailContentPlanningResult> {
    const { screens, screenPlans, projectPath, layoutAssessment, runTool, results, focus } = params;

    const matchResult = await runTool('matchDetailPageContent', {
        screens,
        projectPath,
        screenPlans,
        selectedScene: focus?.selectedScene || undefined,
        selectedDesignContext: focus?.selectedDesignContext || undefined,
        selectedElementContext: focus?.selectedElementContext || undefined,
        selectedModuleContext: focus?.selectedModuleContext || undefined
    });
    results.push({ toolName: 'matchDetailPageContent', result: matchResult });
    if (!matchResult?.success) {
        throw new Error(matchResult?.error || 'Match failed');
    }

    let fillPlans: FillPlan[] = enrichDetailFillPlansWithLayerRelations(matchResult.plans || [], screens);
    const aligned = alignDetailFillPlansToScreens(fillPlans, screens);
    const fitAdjusted = applyDetailImageFitDecisions(aligned.alignedPlans, screens, layoutAssessment);
    fillPlans = fitAdjusted.plans.filter(Boolean) as FillPlan[];
    const projectedScreens = applyDetailFillPlanCopiesToScreens(screens, fillPlans);
    const projectedCopyAudit = auditDetailCopyLayout({
        screens: projectedScreens,
        screenPlans
    });
    const anchorDiagnostics = analyzeDetailImageAnchors(fillPlans, screens);

    return {
        fillPlans,
        projectedCopyAudit,
        anchorDiagnostics,
        copyGenerationSummary: summarizeDetailCopyGeneration(fillPlans),
        fitDecisionCount: fitAdjusted.decisionCount
    };
}

export async function prepareDetailScreenExecutionPlan(params: {
    screen: ParsedScreen;
    screenPlan: DetailScreenPlan | undefined;
    initialPlan: FillPlan | undefined;
    focus?: DetailFocusContext;
    anchorDiagnostics: ReturnType<typeof analyzeDetailImageAnchors>;
    usePlanGuard: boolean;
    allowLowConfidenceFill: boolean;
    minImageCoverage: number;
    projectPath?: string;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<DetailPreparedScreenPlan> {
    const {
        screen,
        screenPlan,
        initialPlan,
        focus,
        anchorDiagnostics,
        usePlanGuard,
        allowLowConfidenceFill,
        minImageCoverage,
        projectPath,
        runTool,
        results
    } = params;

    const notes: string[] = [];
    let rebuilt = false;
    let plan: FillPlan | null | undefined = initialPlan;

    if (!plan) {
        notes.push('初始计划缺失，已尝试单屏重建');
        plan = await rebuildSingleDetailScreenPlan({
            screen,
            screenPlan,
            focus,
            projectPath,
            runTool,
            results
        });
        rebuilt = true;
    }

    if (!plan) {
        return {
            plan: null,
            degraded: false,
            skippedRiskyImageCount: 0,
            notes,
            rebuilt
        };
    }

    let quality = calculateDetailPlanQuality(plan);
    const hasMissingImagePlan = (screen.imagePlaceholders?.length || 0) > 0
        && (plan.images || []).some((image) => !String(image?.imagePath || '').trim());
    const hasImageCoverageRisk = (screen.imagePlaceholders?.length || 0) > 0
        && quality.imageCoverage < minImageCoverage;
    const shouldRebuildScreen = usePlanGuard
        && !allowLowConfidenceFill
        && (hasImageCoverageRisk || hasMissingImagePlan);

    if (shouldRebuildScreen) {
        notes.push('图片覆盖率偏低或存在缺图，已尝试重建单屏计划');
        const rebuiltPlan = await rebuildSingleDetailScreenPlan({
            screen,
            screenPlan,
            focus,
            projectPath,
            runTool,
            results
        });
        if (rebuiltPlan) {
            plan = rebuiltPlan;
            quality = calculateDetailPlanQuality(plan);
            rebuilt = true;
        }
    }

    const riskyLayerIds = new Set(
        (anchorDiagnostics.alerts || [])
            .filter((alert) => alert.screenId === screen.id && alert.severity === 'critical')
            .flatMap((alert) => Array.isArray(alert.layerIds) ? alert.layerIds : [])
            .map((layerId) => Number(layerId))
            .filter((layerId) => Number.isFinite(layerId) && layerId > 0)
    );
    const filteredPlan = removeRiskyPlanImages(plan, riskyLayerIds);
    const skippedRiskyImageCount = Math.max(0, (plan.images?.length || 0) - (filteredPlan.images?.length || 0));
    if (skippedRiskyImageCount > 0) {
        notes.push(`已移除 ${skippedRiskyImageCount} 个高风险图片区`);
    }
    if (screenPlan?.visualSummary?.boundaryRisk === 'risky') {
        notes.push('当前屏视觉边界与结构边界不一致，结果需要重点复核');
    }

    return {
        plan: filteredPlan,
        degraded: skippedRiskyImageCount > 0 || quality.imageCoverage < minImageCoverage,
        skippedRiskyImageCount,
        notes,
        rebuilt
    };
}
