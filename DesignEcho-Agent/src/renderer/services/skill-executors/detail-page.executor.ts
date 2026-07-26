import type { AgentResult } from '../unified-agent.service';
import type { DetailScreenPlan, FillPlan, LayerIssue, ParsedScreen } from './detail-page.types';
import type { SkillExecuteParams, SkillExecutor } from './types';
import type { DesignProjectState } from '../../../shared/types/design-project-state.types';

import { executeToolCall } from '../tool-executor.service';
import { useAppStore } from '../../stores/app.store';
import { analyzeDetailImageAnchors } from './detail-page-plan-utils';
import {
    auditDetailCopyLayoutForScreens as auditDetailCopyLayout
} from '../../../shared/detail-page-copy-layout-audit';
import {
    normalizeDetailFlatLayers,
    reconstructDetailPlacementsFromHierarchy
} from '../../../shared/detail-page-live-placement';
import {
    buildDetailPageDesignAgentOsRecord,
    type DetailPageScreenPlanInput
} from '../../../shared/design-agent-os-contracts';
import {
    buildDetailPageSkillReadiness,
    type DetailPageSkillProjectContext,
    type DetailPageSkillReadiness,
    type DetailPageSkillTemplateContext
} from '../../../shared/detail-page-skill-readiness';
import {
    buildDetailPageAgentIntake,
    buildDetailPageAgentResultSummary,
    type DetailPageAgentIntake
} from '../../../shared/detail-page-agent-intake';
import {
    formatDesignDocumentRole,
    inferDesignDocumentRoleFromName,
    isKnownNonDetailPageRole
} from '../../../shared/design-document-role';
import {
    buildDetailPageVersionPatch,
    selectDetailPageScreensForStateRedo
} from '../../../shared/detail-page-state-consumption';
import { buildDetailPageContentVerification } from '../../../shared/detail-page-content-verification';
import { buildDetailPagePlannerContext } from './design-planner-context';
import {
    buildDetailExecutionSummary as buildExecutionSummary,
    buildDetailInspectionSummary as buildInspectionSummary,
    buildDetailTemplateState,
    formatDetailScreenPlanLine as formatScreenPlanLine,
    planDetailPageContent,
    prepareDetailScreenExecutionPlan,
    resolveDetailExecutionReviewLevel,
    resolveDetailExecutionScope
} from '../design-skills/detail-page-design.skill';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

function clamp01(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
}

function shouldExportFromRequest(params: Record<string, any>, context?: SkillExecuteParams['context']): boolean {
    if (params.exportSlices === true || params.autoExport === true) return true;
    const intent = String(params.userIntent || context?.userInput || '').toLowerCase();
    return ['导出', '输出', '切片', 'export'].some((keyword) => intent.includes(keyword));
}

function shouldCaptureScreenSnapshots(params: Record<string, any>): boolean {
    if (params.includeScreenSnapshots === true) return true;
    const visualValidation = String(params.visualValidation || '').trim().toLowerCase();
    return visualValidation === 'snapshot' || visualValidation === 'screenshots';
}

function buildFailureResult(message: string, error: string, toolResults: any[], data?: any): AgentResult {
    return {
        success: false,
        message,
        error,
        toolResults,
        data
    };
}

function countExportedDetailFiles(exportResult: any): number {
    const candidates = [
        exportResult?.files,
        exportResult?.exports,
        exportResult?.slices,
        exportResult?.exportedFiles,
        exportResult?.results
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate.length;
    }
    const count = Number(exportResult?.count || exportResult?.fileCount || 0);
    return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function filterScreenPlansByScreens(screenPlans: DetailScreenPlan[], screens: ParsedScreen[]): DetailScreenPlan[] {
    const screenIds = new Set((screens || []).map((screen) => Number(screen.id || 0)));
    return (screenPlans || []).filter((plan) => screenIds.has(Number(plan.screenId || 0)));
}

function shouldUseStateReviewRedoScope(params: Record<string, any>, userInput: string): boolean {
    if (params.redoFromStateReview === true || params.onlyReviewIssues === true) return true;
    const text = String(userInput || params.userIntent || '').toLowerCase();
    if (!text) return false;
    const asksRevision = /(重做|返工|修改|修复|修一下|调整|优化|redo|revise|fix)/i.test(text);
    const detailScope = /(详情|detail|屏|这一屏|这屏|问题|复核|review)/i.test(text);
    return asksRevision && detailScope;
}

function extractOpenPhotoshopDocuments(result: any): Array<{ name: string; isActive?: boolean }> {
    const candidates = [
        result?.documents,
        result?.openDocuments,
        result?.data?.documents,
        result?.data?.openDocuments,
        result?.result?.documents
    ];
    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        return candidate
            .map((item) => ({
                name: String(item?.name || item?.documentName || item?.title || '').trim(),
                isActive: item?.isActive === true
            }))
            .filter((item) => item.name);
    }
    return [];
}

function pickDetailPageDocumentName(documents: Array<{ name: string; isActive?: boolean }>): string {
    const exact = documents.find((doc) => inferDesignDocumentRoleFromName(doc.name) === 'detailPage');
    return exact?.name || '';
}

async function readDesignProjectStateForDetailPage(
    projectPath: string,
    results: Array<Record<string, unknown>>
): Promise<DesignProjectState | null> {
    if (!projectPath || typeof window === 'undefined') return null;
    const designEcho = (window as any).designEcho;
    if (!designEcho?.getDesignState) return null;
    try {
        const state = await designEcho.getDesignState(projectPath);
        results.push({
            toolName: 'getDesignProjectState[detail-page]',
            result: {
                success: true,
                hasState: Boolean(state),
                copywritingCount: Array.isArray(state?.copywriting) ? state.copywriting.length : 0,
                sellingPointCount: Array.isArray(state?.sellingPoints) ? state.sellingPoints.length : 0,
                hasVisualDirection: Boolean(state?.visualDirection)
            }
        });
        return state || null;
    } catch (error: any) {
        results.push({
            toolName: 'getDesignProjectState[detail-page]',
            result: {
                success: false,
                error: error?.message || String(error)
            }
        });
        return null;
    }
}

async function appendDetailPageVersionRecord(params: {
    projectPath: string;
    action: 'fill' | 'export' | 'screen-redo';
    screens: ParsedScreen[];
    reason?: string;
    exportedFileCount?: number;
    results: Array<Record<string, unknown>>;
}) {
    if (!params.projectPath || typeof window === 'undefined') return null;
    const patch = buildDetailPageVersionPatch({
        action: params.action,
        screens: params.screens,
        reason: params.reason,
        exportedFileCount: params.exportedFileCount
    });
    if (!patch) return null;
    const designEcho = (window as any).designEcho;
    if (!designEcho?.updateDesignState) return null;
    try {
        const result = await designEcho.updateDesignState(params.projectPath, patch);
        params.results.push({
            toolName: `updateDesignProjectState[detail-page:${params.action}]`,
            result
        });
        return result;
    } catch (error: any) {
        const result = {
            success: false,
            error: error?.message || String(error)
        };
        params.results.push({
            toolName: `updateDesignProjectState[detail-page:${params.action}]`,
            result
        });
        return result;
    }
}

function buildDetailPageScreenPlanInputs(
    screenPlans: DetailScreenPlan[],
    fillPlans: FillPlan[] = [],
    resultByScreenId: Map<number, string> = new Map()
): DetailPageScreenPlanInput[] {
    const fillPlanByScreenId = new Map<number, FillPlan>();
    for (const fillPlan of fillPlans || []) {
        const screenId = Number((fillPlan as any)?.screenId || 0);
        if (screenId) fillPlanByScreenId.set(screenId, fillPlan);
    }
    return (screenPlans || []).map((plan) => {
        const screenId = Number((plan as any)?.screenId || 0);
        const fillPlan = fillPlanByScreenId.get(screenId) as any;
        const visualSummary = (plan as any)?.visualSummary || {};
        const riskCount = [
            visualSummary.boundaryRisk === 'risky',
            Array.isArray((plan as any)?.risks) && (plan as any).risks.length > 0
        ].filter(Boolean).length;
        return {
            screenId: String(screenId || (plan as any)?.screenName || 'unknown'),
            role: String((plan as any)?.screenRole || (plan as any)?.role || ''),
            decisionSource: String((plan as any)?.decisionSource || 'unknown'),
            requiresModelDecision: Boolean((plan as any)?.requiresModelDecision),
            riskCount,
            plannedCopyCount: Array.isArray(fillPlan?.copies) ? fillPlan.copies.length : undefined,
            plannedImageCount: Array.isArray(fillPlan?.images) ? fillPlan.images.length : undefined,
            resultStatus: resultByScreenId.get(screenId)
        };
    });
}

function buildDetailPageProjectReadinessContext(
    context: SkillExecuteParams['context'],
    projectPath: string
): DetailPageSkillProjectContext {
    const projectContext = context?.projectContext;
    const assetIndex = projectContext?.assetIndex;
    const visualSamplingPlan = projectContext?.visualSamplingPlan;
    const visualInsightCache = projectContext?.visualInsightCache;

    return {
        projectPathKnown: Boolean(projectPath || projectContext?.projectPath),
        assetImageCount: Number(assetIndex?.summary.totalImages || 0),
        visualCandidateCount: Number(assetIndex?.visionCandidates.length || 0),
        selectedCandidateCount: Number(visualSamplingPlan?.selectedCandidates.length || 0),
        visualInsightCount: Number(visualInsightCache?.summary.entriesWithInsight || 0),
        shouldAnalyzeCount: Number(visualSamplingPlan?.cacheSummary.shouldAnalyze || 0)
    };
}

function buildDetailPageTemplateReadinessContext(input: {
    parseResult?: any;
    screens?: ParsedScreen[];
    issues?: LayerIssue[];
    crossScreenRiskCount?: number;
    readiness?: { mode?: string; metrics?: Record<string, any> };
}): DetailPageSkillTemplateContext {
    const metrics = input.readiness?.metrics || {};
    const screens = input.screens || [];
    const issues = input.issues || [];

    return {
        parseSuccess: input.parseResult?.success === true,
        screenCount: Number(input.parseResult?.screenCount || screens.length || 0),
        readinessMode: input.readiness?.mode || undefined,
        issueCount: Number(issues.length || 0),
        crossScreenRiskCount: Number(input.crossScreenRiskCount || 0),
        copyPlaceholderCount: Number(metrics.copyPlaceholderCount || 0),
        imagePlaceholderCount: Number(metrics.imagePlaceholderCount || 0)
    };
}

function buildDetailPageSkillReadinessContext(input: {
    inspectOnly: boolean;
    parseResult?: any;
    screens?: ParsedScreen[];
    issues?: LayerIssue[];
    crossScreenRiskCount?: number;
    readiness?: { mode?: string; metrics?: Record<string, any> };
    context: SkillExecuteParams['context'];
    projectPath: string;
}): DetailPageSkillReadiness {
    return buildDetailPageSkillReadiness({
        mode: input.inspectOnly ? 'inspect' : 'execute',
        template: buildDetailPageTemplateReadinessContext({
            parseResult: input.parseResult,
            screens: input.screens,
            issues: input.issues,
            crossScreenRiskCount: input.crossScreenRiskCount,
            readiness: input.readiness
        }),
        project: buildDetailPageProjectReadinessContext(input.context, input.projectPath),
        imagePlacementCoreAvailable: true,
        verificationToolsAvailable: true
    });
}

export const detailPageExecutor: SkillExecutor = {
    skillId: 'detail-page-design',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const startedAt = Date.now();
        const results: any[] = [];
        const phaseDurations: Record<string, number> = {};
        const markPhaseDuration = (name: string, phaseStartedAt: number) => {
            phaseDurations[name] = Math.max(0, Date.now() - phaseStartedAt);
        };

        const report = (message: string, percent: number, options?: { thinking?: boolean; assistant?: boolean }) => {
            callbacks?.onProgress?.(message, percent);
            if (options?.thinking !== false) {
                callbacks?.onStatus?.(message);
            }
            if (options?.assistant === true) {
                callbacks?.onMessage?.(message);
            }
        };
        const emitStep = (
            kind: Parameters<typeof emitSkillStep>[1]['kind'],
            title: string,
            detail?: string,
            status: Parameters<typeof emitSkillStep>[1]['status'] = 'running',
            percent?: number
        ) => emitSkillStep(callbacks, { kind, title, detail, status, percent });
        const callTool = (toolName: string, toolParams: Record<string, any>, detail?: string) => {
            return executeObservedSkillTool(callbacks, toolName, toolParams, executeToolCall, detail);
        };

        const detailPageAgentIntake: DetailPageAgentIntake = buildDetailPageAgentIntake({ params, context });
        params = {
            ...(params || {}),
            ...detailPageAgentIntake.params
        };
        const blockedIntakeResultSummary = () => buildDetailPageAgentResultSummary({
            intake: detailPageAgentIntake,
            runtime: {
                success: false,
                blockers: detailPageAgentIntake.blockers,
                warnings: detailPageAgentIntake.warnings
            }
        });

        if (!detailPageAgentIntake.canStart) {
            const detailPageAgentResultSummary = blockedIntakeResultSummary();
            emitStep(
                'warning',
                '详情页执行上下文不足',
                detailPageAgentIntake.agentReadableText,
                'error',
                0.04
            );
            callbacks?.onStatus?.(detailPageAgentIntake.agentReadableText);
            return buildFailureResult(
                detailPageAgentIntake.agentReadableText,
                'detail_page_agent_intake_blocked',
                results,
                {
                    detailPageAgentIntake,
                    detailPageAgentResultSummary,
                    detailPageSkillReadiness: detailPageAgentIntake.readiness
                }
            );
        }

        const projectPath = String(params.projectPath || context?.projectContext?.projectPath || '').trim();
        const userInputForOs = String(params.userIntent || context?.userInput || '').trim();
        const inspectOnly = params.inspectOnly === true || String(params.structureMode || '').toLowerCase() === 'inspect';
        const autoFix = !inspectOnly && params.autoFix !== false;
        const usePlanGuard = params.planGuard !== false;
        const allowLowConfidenceFill = params.allowLowConfidenceFill === true;
        const minPlanConfidence = clamp01(Number(params.minPlanConfidence), 0.62);
        const minImageCoverage = clamp01(Number(params.minImageCoverage), 0.6);

        const currentDocumentName = String(context?.photoshopContext?.documentName || '').trim();
        const currentDocumentRole = inferDesignDocumentRoleFromName(currentDocumentName);
        if (currentDocumentName && isKnownNonDetailPageRole(currentDocumentRole)) {
            const roleLabel = formatDesignDocumentRole(currentDocumentRole);
            emitStep(
                'observation',
                '当前文档不是详情页',
                `当前 Photoshop 文档是「${currentDocumentName}」，按名称识别为${roleLabel}文档；详情页技能需要先切换到详情页文档。`,
                'running',
                0.05
            );
            const openDocumentsResult = await callTool('listDocuments', { includeDetails: true }, '查找是否已有打开的详情页文档。');
            results.push({ toolName: 'listDocuments[detailDocumentRole]', result: openDocumentsResult });
            const detailDocumentName = pickDetailPageDocumentName(extractOpenPhotoshopDocuments(openDocumentsResult));

            if (detailDocumentName) {
                emitStep(
                    'tool_started',
                    '切换到详情页文档',
                    `已找到「${detailDocumentName}」，先切换文档再继续详情页解析。`,
                    'running',
                    0.07
                );
                const switchResult = await callTool('switchDocument', { documentName: detailDocumentName }, `切换到详情页文档：${detailDocumentName}`);
                results.push({ toolName: 'switchDocument[detailDocumentRole]', result: switchResult });
                if (!switchResult?.success) {
                    const message = `当前是${roleLabel}文档「${currentDocumentName}」，并且切换到详情页文档「${detailDocumentName}」失败。`;
                    emitStep('warning', '详情页文档切换失败', message, 'error', 0.08);
                    return buildFailureResult(
                        message,
                        'detail_page_document_switch_failed',
                        results,
                        {
                            currentDocumentName,
                            currentDocumentRole,
                            targetDocumentName: detailDocumentName
                        }
                    );
                }
            } else {
                const message = `当前是${roleLabel}文档「${currentDocumentName}」，没有找到已打开的详情页文档；详情页技能不会在非详情页文档上继续执行。`;
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: [message],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep('warning', '未找到详情页文档', message, 'error', 0.08);
                return buildFailureResult(
                    message,
                    'detail_page_document_role_mismatch',
                    results,
                    {
                        detailPageAgentIntake,
                        detailPageAgentResultSummary,
                        currentDocumentName,
                        currentDocumentRole
                    }
                );
            }
        }

        const designProjectState = await readDesignProjectStateForDetailPage(projectPath, results);

        try {
            const buildTemplateState = async (
                nextScreens: ParsedScreen[],
                nextIssues: LayerIssue[],
                crossScreenRiskCount: number
            ) => buildDetailTemplateState({
                screens: nextScreens,
                issues: nextIssues,
                crossScreenRiskCount,
                runTool: executeToolCall,
                results,
                designProjectState,
                visualInsightCache: context?.projectContext?.visualInsightCache || null
            });

            const templatePhaseStartedAt = Date.now();
            emitStep(
                'observation',
                '准备执行详情页技能',
                inspectOnly ? '当前请求为模板结构检查，不执行填充。' : '当前请求会解析模板、规划内容并按屏填充。',
                'running',
                0.04
            );
            report('先检查当前详情页模板结构。', 0.08);
            let parseResult = await callTool('parseDetailPageTemplate', { includeStructure: true }, '读取详情页屏结构、占位符和跨屏图层风险。');
            results.push({ toolName: 'parseDetailPageTemplate', result: parseResult });

            if (!parseResult?.success) {
                // 解析失败最常见的语境是 Photoshop 没有打开文档：UXP 工具此时返回
                // success:false 且 documentName/documentSize 全空，但不带 error 字段——
                // 必须翻译成用户能行动的指引，而不是「未知错误」。
                const noDocumentContext = !parseResult?.documentName
                    && !(Number(parseResult?.documentSize?.width) > 0);
                const failureReason = parseResult?.error
                    || (noDocumentContext
                        ? 'Photoshop 当前没有打开的文档。请先在 Photoshop 中打开详情页模板（PSD/PSB），再重新发起请求。'
                        : 'parseDetailPageTemplate 未返回成功状态，且没有给出失败原因；请检查当前文档是否是详情页模板结构。');
                const detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                    inspectOnly,
                    parseResult,
                    context,
                    projectPath
                });
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: [`详情页模板解析失败: ${failureReason}`],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep(
                    'warning',
                    '详情页模板解析失败',
                    failureReason,
                    'error',
                    0.1
                );
                return buildFailureResult(
                    `详情页模板解析失败: ${failureReason}`,
                    failureReason,
                    results,
                    { detailPageAgentIntake, detailPageAgentResultSummary, detailPageSkillReadiness }
                );
            }

            // 按用户尺寸规范评估文档宽度（提示性检查，不拦截执行——多尺寸版本工作流见规范说明）
            try {
                const { normalizeDesignDimensionSpec, evaluateDetailPageDocumentWidth } =
                    await import('../../../shared/design-dimension-spec');
                const widthSpec = normalizeDesignDimensionSpec(useAppStore.getState().designDimensionSpec);
                const widthEvaluation = evaluateDetailPageDocumentWidth(widthSpec, Number(parseResult?.documentSize?.width) || 0);
                emitStep(
                    widthEvaluation.ok ? 'observation' : 'warning',
                    widthEvaluation.ok ? '文档宽度符合尺寸规范' : '文档宽度不在尺寸规范内',
                    widthEvaluation.hint,
                    'success',
                    0.1
                );
            } catch (error: any) {
                console.warn(`[DetailPage] 尺寸规范评估失败（不影响执行）：${error?.message || error}`);
            }

            let screens: ParsedScreen[] = parseResult.screens || [];
            if (screens.length === 0) {
                const detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                    inspectOnly,
                    parseResult,
                    screens,
                    context,
                    projectPath
                });
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: ['当前文档没有识别到可用的详情页屏结构。'],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep('warning', '详情页模板解析无可用屏', '当前文档没有识别到详情页屏结构。', 'error', 0.1);
                return buildFailureResult(
                    '当前文档没有识别到可用的详情页屏结构。',
                    'No parsed screens',
                    results,
                    { detailPageAgentIntake, detailPageAgentResultSummary, detailPageSkillReadiness }
                );
            }

            emitStep(
                'verification',
                '详情页模板解析完成',
                `识别到 ${screens.length} 屏，跨屏图层风险 ${Array.isArray(parseResult.crossScreenLayers) ? parseResult.crossScreenLayers.length : 0} 个。`,
                'success',
                0.12
            );
            callbacks?.onStatus?.(`已识别到 ${screens.length} 屏，先检查结构问题和可自动化程度。`);
            report('正在评估模板是否适合自动化。', 0.16, { assistant: false });
            let detectResult = await callTool('detectLayerIssues', { screens }, '检查详情页图层命名、分组和可自动化风险。');
            results.push({ toolName: 'detectLayerIssues', result: detectResult });

            let issues: LayerIssue[] = detectResult?.issues || [];
            let crossScreenRiskCount = Array.isArray(parseResult.crossScreenLayers) ? parseResult.crossScreenLayers.length : 0;
            let {
                readiness,
                layoutGraphs,
                layoutAssessment,
                placeholderAnchorDiagnostics,
                visualPlanning,
                screenPlans,
                projectStateContext,
                templateCopyAudit,
                structureAlerts,
                focus
            } = await buildTemplateState(screens, issues, crossScreenRiskCount);
            let detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                inspectOnly,
                parseResult,
                screens,
                issues,
                crossScreenRiskCount,
                readiness,
                context,
                projectPath
            });
            markPhaseDuration('模板解析', templatePhaseStartedAt);

            emitStep(
                'verification',
                '详情页模板评估完成',
                `就绪度 ${readiness.mode}，版式 ${layoutAssessment.mode}，文案位 ${readiness.metrics.copyPlaceholderCount} 个，图片区 ${readiness.metrics.imagePlaceholderCount} 个。`,
                'success',
                0.22
            );
            callbacks?.onStatus?.(
                `模板评估为 ${readiness.mode}，识别到 ${readiness.metrics.copyPlaceholderCount} 个文案位、${readiness.metrics.imagePlaceholderCount} 个图片区。`
            );
            callbacks?.onStatus?.(`版式评估为 ${layoutAssessment.mode}，当前平均得分 ${Math.round(layoutAssessment.score * 100)}。`);
            callbacks?.onStatus?.(
                `视觉分块判断为 ${visualPlanning.mergeStatus}，识别到 ${visualPlanning.visualScreenCount} 个视觉屏、${visualPlanning.visualModuleCount} 个视觉模块。`
            );
            if (placeholderAnchorDiagnostics.warnings.length > 0) {
                callbacks?.onStatus?.(`模板里还存在 ${placeholderAnchorDiagnostics.warnings.length} 条图片区锚点风险。`);
            }

            if (inspectOnly) {
                emitStep('finalizing', '详情页结构检查结果已汇总', '仅输出模板诊断，不修改 Photoshop 文档。', 'success', 1);
                callbacks?.onStatus?.('结构检查已完成，正在整理诊断结论。');
                const designAgentOs = buildDetailPageDesignAgentOsRecord({
                    userInput: userInputForOs,
                    screenCount: screens.length,
                    screens: buildDetailPageScreenPlanInputs(screenPlans),
                    toolResults: results,
                    success: true,
                    warnings: [
                        ...structureAlerts.map((alert) => String(alert)),
                        ...placeholderAnchorDiagnostics.warnings.map((warning) => String(warning))
                    ]
                });
                const designPlanner = buildDetailPagePlannerContext({
                    userInput: userInputForOs,
                    params,
                    context,
                    projectPath,
                    screenCount: screens.length,
                    mode: 'inspect',
                    readinessMode: readiness.mode,
                    screenPlanCount: screenPlans.length
                });
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: true,
                        reviewLevel: 'inspect_only',
                        screenCount: screens.length,
                        successCount: screens.length,
                        failCount: 0,
                        warnings: [
                            ...structureAlerts.map((alert) => String(alert)),
                            ...placeholderAnchorDiagnostics.warnings.map((warning) => String(warning))
                        ]
                    }
                });
                return {
                    success: true,
                    message: buildInspectionSummary({
                        screens,
                        screenPlans,
                    readiness,
                    layoutAssessment,
                    visualPlanning,
                    focus,
                    anchorDiagnostics: placeholderAnchorDiagnostics,
                    copyLayoutAudit: templateCopyAudit,
                    totalTime: Date.now() - startedAt
                }),
                    toolResults: results,
                    data: {
                        inspectOnly: true,
                        readiness,
                        layoutGraphs,
                        layoutAssessment,
                        screenPlans,
                        screenPlanLines: screenPlans.map(formatScreenPlanLine),
                        projectStateContext,
                        visualPlanning,
                        focus,
                        copyLayoutAudit: templateCopyAudit,
                        anchorDiagnostics: placeholderAnchorDiagnostics,
                        structureAlerts,
                        detailPageAgentIntake,
                        detailPageAgentResultSummary,
                        detailPageSkillReadiness,
                        businessSkillMemoryContext: designPlanner.businessSkillMemoryContext,
                        businessSkillMemoryStrategy: designPlanner.businessSkillMemoryStrategy,
                        detailPageMemoryStrategy: designPlanner.detailPageMemoryStrategy,
                        ecommerceSocksChildStrategyInput: designPlanner.ecommerceSocksChildStrategyInput,
                        detailPageDesignPlacementIntelligence: designPlanner.detailPageDesignPlacementIntelligence,
                        businessSkillDesignPlacementIntelligence: designPlanner.businessSkillDesignPlacementIntelligence,
                        designAgentOs,
                        designPlanner,
                        stats: {
                            screensProcessed: screens.length,
                            issueCount: issues.length
                        }
                    }
                };
            }

            if (signal?.aborted) {
                return {
                    success: false,
                    cancelled: true,
                    message: '已取消。',
                    toolResults: results,
                    data: { readiness, layoutGraphs, layoutAssessment }
                };
            }

            const scopePhaseStartedAt = Date.now();
            emitStep('observation', '准备确认详情页执行范围', '根据结构问题判断是否可继续自动修复和填充。', 'running', 0.28);
            const executionScope = await resolveDetailExecutionScope({
                screens,
                issues,
                crossScreenRiskCount,
                autoFix,
                runTool: executeToolCall,
                results,
                designProjectState,
                visualInsightCache: context?.projectContext?.visualInsightCache || null
            });
            markPhaseDuration('结构修复', scopePhaseStartedAt);

            if (!executionScope.canProceed) {
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: [executionScope.failureMessage || executionScope.failureReason || '模板结构不满足自动执行条件。'],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep(
                    'warning',
                    '详情页执行范围不可继续',
                    executionScope.failureMessage || executionScope.failureReason || '模板结构不满足自动执行条件。',
                    'error',
                    0.32
                );
                return buildFailureResult(
                    executionScope.failureMessage || '当前模板不适合自动执行',
                    executionScope.failureReason || 'Template scope resolution failed',
                    results,
                    {
                        detailPageAgentIntake,
                        detailPageAgentResultSummary,
                        readiness,
                        layoutGraphs,
                        layoutAssessment,
                        visualPlanning,
                        screenPlans,
                        projectStateContext,
                        templateCopyAudit,
                        detailPageSkillReadiness
                    }
                );
            }

            screens = executionScope.screens;
            issues = executionScope.issues;
            crossScreenRiskCount = executionScope.crossScreenRiskCount;
            ({
                readiness,
                layoutGraphs,
                layoutAssessment,
                placeholderAnchorDiagnostics,
                visualPlanning,
                screenPlans,
                projectStateContext,
                templateCopyAudit,
                structureAlerts,
                focus
            } = executionScope.templateState);

            let detailExecutionAction: 'fill' | 'screen-redo' = 'fill';
            if (shouldUseStateReviewRedoScope(params, userInputForOs) && designProjectState) {
                const redoScreens = selectDetailPageScreensForStateRedo({
                    state: designProjectState,
                    screens
                }) as ParsedScreen[];
                if (redoScreens.length > 0 && redoScreens.length < screens.length) {
                    screens = redoScreens;
                    screenPlans = filterScreenPlansByScreens(screenPlans, screens);
                    projectStateContext = {
                        ...projectStateContext,
                        redoScreenIds: screens.map((screen) => Number(screen.id || 0)).filter((id) => id > 0)
                    };
                    detailExecutionAction = 'screen-redo';
                    const scopeMessage = `按项目复核结果只重做 ${screens.map((screen) => screen.name).join('、')}。`;
                    results.push({
                        toolName: 'resolveDetailStateRedoScope',
                        result: {
                            success: true,
                            screenIds: screens.map((screen) => screen.id),
                            screenNames: screens.map((screen) => screen.name)
                        }
                    });
                    callbacks?.onStatus?.(scopeMessage);
                }
            }

            detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                inspectOnly,
                parseResult,
                screens,
                issues,
                crossScreenRiskCount,
                readiness,
                context,
                projectPath
            });

            for (const note of executionScope.notes) {
                callbacks?.onStatus?.(note);
            }

            const assetPhaseStartedAt = Date.now();
            report('正在整理当前项目素材。', 0.34);
            const assetAnalysis = await callTool(
                'analyzeProjectForDetailPage',
                { projectPath },
                projectPath ? '读取当前项目中的详情页可用素材。' : '没有项目路径时仅按当前上下文尝试分析素材。'
            );
            results.push({ toolName: 'analyzeProjectForDetailPage', result: assetAnalysis });
            markPhaseDuration('素材分析', assetPhaseStartedAt);

            if (!projectPath) {
                callbacks?.onStatus?.('当前没有明确项目路径，接下来只能按当前上下文和已知素材做匹配。');
            }

            const planningPhaseStartedAt = Date.now();
            emitStep(
                'observation',
                '开始生成详情页填充计划',
                `基于 ${screens.length} 屏结构、模板评估和项目素材生成文案与图片放置计划。`,
                'running',
                0.42
            );
            report('正在为每一屏生成填充计划。', 0.46);
            const plannedContent = await planDetailPageContent({
                screens,
                screenPlans,
                focus,
                projectPath,
                layoutAssessment,
                runTool: executeToolCall,
                results
            });
            let fillPlans: FillPlan[] = plannedContent.fillPlans;
            const projectedCopyAudit = plannedContent.projectedCopyAudit;
            const anchorDiagnostics = plannedContent.anchorDiagnostics;
            const copyGenerationSummary = plannedContent.copyGenerationSummary;
            const placementRecords: any[] = [];
            const screenPlanById = new Map<number, DetailScreenPlan>(screenPlans.map((plan) => [plan.screenId, plan]));
            emitStep(
                'verification',
                '详情页填充计划已生成',
                `填充计划 ${fillPlans.length} 个，图片区放置决策 ${plannedContent.fitDecisionCount} 个，锚点风险 ${anchorDiagnostics.warnings.length} 条。`,
                'success',
                0.52
            );
            callbacks?.onStatus?.(`已为 ${plannedContent.fitDecisionCount} 个图片区生成放置决策，接下来开始逐屏填充。`);
            if (anchorDiagnostics.warnings.length > 0) {
                callbacks?.onStatus?.(`检测到 ${anchorDiagnostics.warnings.length} 条放图锚点风险，执行时会优先局部修正。`);
            }
            markPhaseDuration('内容规划', planningPhaseStartedAt);

            const degradedScreenNames: string[] = [];
            const executedFillPlans: FillPlan[] = [];
            let successCount = 0;
            let failCount = 0;
            const resultByScreenId = new Map<number, string>();

            const fillPhaseStartedAt = Date.now();
            report('开始按屏执行详情页填充。', 0.58, { assistant: false });
            emitStep('observation', '开始按屏执行详情页填充', `待处理 ${screens.length} 屏。`, 'running', 0.58);

            for (let i = 0; i < screens.length; i++) {
                if (signal?.aborted) {
                    return {
                        success: false,
                        cancelled: true,
                        message: '已取消。',
                        toolResults: results,
                        data: { readiness, layoutGraphs, layoutAssessment }
                    };
                }

                const screen = screens[i];
                const screenPlan = screenPlanById.get(screen.id);
                const prepared = await prepareDetailScreenExecutionPlan({
                    screen,
                    screenPlan,
                    initialPlan: fillPlans[i] as FillPlan | undefined,
                    focus,
                    anchorDiagnostics,
                    usePlanGuard,
                    allowLowConfidenceFill,
                    minImageCoverage,
                    projectPath,
                    runTool: executeToolCall,
                    results
                });
                if (!prepared.plan) {
                    failCount++;
                    resultByScreenId.set(screen.id, 'failed:no-executable-plan');
                    emitStep(
                        'warning',
                        '单屏填充计划缺失',
                        `${screen.name}: 单屏重建后仍没有可执行计划。`,
                        'error',
                        0.58 + ((i + 1) / Math.max(1, screens.length)) * 0.14
                    );
                    callbacks?.onStatus?.(`${screen.name}: 单屏重建后仍没有可执行计划。`);
                    continue;
                }

                emitStep(
                    'observation',
                    '准备填充详情页屏',
                    `第 ${i + 1}/${screens.length} 屏：${screen.name}`,
                    'running',
                    0.58 + (i / Math.max(1, screens.length)) * 0.14
                );
                callbacks?.onStatus?.(`正在处理第 ${i + 1}/${screens.length} 屏: ${screen.name}`);
                for (const note of prepared.notes) {
                    callbacks?.onStatus?.(`${screen.name}: ${note}`);
                }

                const planToApply: FillPlan = prepared.plan;
                executedFillPlans.push(planToApply);
                if (prepared.degraded) {
                    degradedScreenNames.push(screen.name);
                }

                const fillResult = await callTool('fillDetailPage', { plan: planToApply }, `填充详情页屏：${screen.name}`);
                results.push({ toolName: `fillDetailPage[${screen.name}]`, result: fillResult });
                if (Array.isArray(fillResult?.placements) && fillResult.placements.length > 0) {
                    placementRecords.push(...fillResult.placements);
                }

                if (fillResult?.success) {
                    successCount++;
                    resultByScreenId.set(screen.id, 'passed');
                    emitStep(
                        'verification',
                        '单屏填充完成',
                        `${screen.name}: 填充工具返回成功。`,
                        'success',
                        0.58 + ((i + 1) / Math.max(1, screens.length)) * 0.14
                    );
                } else {
                    failCount++;
                    resultByScreenId.set(screen.id, 'failed:fill-tool');
                    emitStep(
                        'warning',
                        '单屏填充失败',
                        `${screen.name}: ${String(fillResult?.error || 'fillDetailPage 返回失败状态。')}`,
                        'error',
                        0.58 + ((i + 1) / Math.max(1, screens.length)) * 0.14
                    );
                }
            }
            markPhaseDuration('执行填充', fillPhaseStartedAt);
            if (successCount > 0) {
                await appendDetailPageVersionRecord({
                    projectPath,
                    action: detailExecutionAction,
                    screens,
                    reason: `成功 ${successCount} 屏，失败 ${failCount} 屏`,
                    results
                });
            }

            const auditPhaseStartedAt = Date.now();
            report('正在回读 PSD，复核文案和图片区结果。', 0.76, { assistant: false });
            emitStep('observation', '开始回读详情页执行结果', '重新读取 PSD 结构、图层层级和放置结果。', 'running', 0.76);
            const liveParseResult = await callTool('parseDetailPageTemplate', { includeStructure: true }, '回读执行后的详情页屏结构。');
            results.push({ toolName: 'parseDetailPageTemplate[liveAudit]', result: liveParseResult });
            const liveScreens: ParsedScreen[] = liveParseResult?.success ? (liveParseResult.screens || []) : screens;
            const liveScreenPlans = filterScreenPlansByScreens(screenPlans, liveScreens);
            const liveCopyLayoutAudit = auditDetailCopyLayout({
                screens: liveScreens,
                screenPlans: liveScreenPlans
            });

            const hierarchyResult = await callTool('getLayerHierarchy', { includeBounds: true, flatList: true }, '读取执行后的图层边界和层级。');
            results.push({ toolName: 'getLayerHierarchy[livePlacement]', result: hierarchyResult });
            const livePlacementState = reconstructDetailPlacementsFromHierarchy(
                liveScreens,
                normalizeDetailFlatLayers(hierarchyResult),
                0.18
            );

            let placementAuditResult: any = {
                success: true,
                warnings: [],
                riskyScreenIds: []
            };
            if (livePlacementState.placements.length > 0) {
                placementAuditResult = await callTool('auditDetailPagePlacement', {
                    screens: liveScreens,
                    placements: livePlacementState.placements
                }, '校验图片区实际放置位置和目标占位关系。');
                results.push({ toolName: 'auditDetailPagePlacement', result: placementAuditResult });
            }

            emitStep(
                'verification',
                '详情页结果复核完成',
                `回读屏数 ${liveScreens.length}，实际放置 ${livePlacementState.placements.length} 个，未匹配占位 ${livePlacementState.unmatchedPlaceholders.length} 个。`,
                (placementAuditResult?.warnings?.length || 0) > 0 ? 'error' : 'success',
                0.8
            );
            if ((placementAuditResult?.warnings?.length || 0) > 0) {
                callbacks?.onStatus?.(`放置校验发现 ${placementAuditResult.warnings.length} 条风险，最终结果需要复核。`);
            }
            markPhaseDuration('结果复核', auditPhaseStartedAt);

            let snapshotResult: any;
            if (shouldCaptureScreenSnapshots(params)) {
                const snapshotPhaseStartedAt = Date.now();
                report('正在做屏级截图校验。', 0.82);
                snapshotResult = await callTool('getScreenSnapshots', { screens: liveScreens, maxWidth: 1200 }, '采集屏级截图进行视觉复核。');
                results.push({ toolName: 'getScreenSnapshots', result: snapshotResult });
                markPhaseDuration('截图校验', snapshotPhaseStartedAt);
            }

            let exportResult: any;
            if (shouldExportFromRequest(params, context)) {
                const exportPhaseStartedAt = Date.now();
                report('正在导出详情页切片。', 0.92);
                // 导出默认值来自用户尺寸规范（设置可覆盖，未设置走预设），参数显式传入时优先
                const { normalizeDesignDimensionSpec } = await import('../../../shared/design-dimension-spec');
                const dimensionSpec = normalizeDesignDimensionSpec(useAppStore.getState().designDimensionSpec);
                exportResult = await callTool('exportDetailPageSlices', {
                    screens: liveScreens,
                    config: {
                        outputDir: params.outputDir || projectPath,
                        format: params.exportFormat || dimensionSpec.exportDefaults.format,
                        quality: params.exportQuality || dimensionSpec.exportDefaults.quality,
                        createSubfolder: true,
                        subfolder: '详情'
                    }
                }, '按屏导出详情页切片。');
                results.push({ toolName: 'exportDetailPageSlices', result: exportResult });
                const exportedFileCount = countExportedDetailFiles(exportResult);
                if (exportResult?.success || exportedFileCount > 0) {
                    await appendDetailPageVersionRecord({
                        projectPath,
                        action: 'export',
                        screens: liveScreens,
                        exportedFileCount,
                        results
                    });
                }
                markPhaseDuration('导出切片', exportPhaseStartedAt);
            }

            const livePlacementDiagnostics = {
                placementCount: livePlacementState.placements.length,
                unmatchedPlaceholderCount: livePlacementState.unmatchedPlaceholders.length,
                diagnostics: livePlacementState.diagnostics,
                unmatchedPlaceholders: livePlacementState.unmatchedPlaceholders
            };
            const reviewLevel = resolveDetailExecutionReviewLevel({
                failCount,
                degradedScreenCount: degradedScreenNames.length,
                readinessMode: readiness.mode,
                layoutMode: layoutAssessment.mode,
                visualMergeStatus: visualPlanning.mergeStatus,
                hasBoundaryRisk: screenPlans.some((plan) => plan.visualSummary?.boundaryRisk === 'risky'),
                anchorWarningCount: anchorDiagnostics.warnings.length,
                templateCopyWarningCount: templateCopyAudit.summary.warningCount || 0,
                liveCopyRiskyCount: liveCopyLayoutAudit.summary.riskyCopyCount || 0,
                liveCopyWarningCount: liveCopyLayoutAudit.summary.warningCount || 0,
                unmatchedPlaceholderCount: livePlacementDiagnostics.unmatchedPlaceholderCount,
                riskyPlacementCount: placementAuditResult?.riskyScreenIds?.length || 0
            });
            const needsReview = reviewLevel !== 'ok';
            const designAgentOs = buildDetailPageDesignAgentOsRecord({
                userInput: userInputForOs,
                screenCount: liveScreens.length,
                screens: buildDetailPageScreenPlanInputs(screenPlans, fillPlans, resultByScreenId),
                toolResults: results,
                success: failCount === 0,
                completionContract: {
                    status: failCount === 0 && !needsReview ? 'passed' : (failCount === 0 ? 'needs_review' : 'failed'),
                    summary: `详情页执行成功 ${successCount} 屏，失败 ${failCount} 屏，复核等级 ${reviewLevel}。`,
                    blockers: failCount > 0 ? [`${failCount} 屏填充失败或缺少可执行计划。`] : [],
                    warnings: [
                        ...degradedScreenNames.map((name) => `${name}: 降级填充`),
                        ...anchorDiagnostics.warnings.map((warning) => String(warning)),
                        ...((placementAuditResult?.warnings || []) as any[]).map((warning) => String(warning))
                    ]
                }
            });
            const designPlanner = buildDetailPagePlannerContext({
                userInput: userInputForOs,
                params,
                context,
                projectPath,
                screenCount: liveScreens.length,
                mode: 'execute',
                readinessMode: readiness.mode,
                screenPlanCount: screenPlans.length
            });
            detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                inspectOnly,
                parseResult: liveParseResult?.success ? liveParseResult : parseResult,
                screens: liveScreens,
                issues,
                crossScreenRiskCount,
                readiness,
                context,
                projectPath
            });
            const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                intake: detailPageAgentIntake,
                runtime: {
                    success: failCount === 0,
                    reviewLevel,
                    screenCount: liveScreens.length,
                    successCount,
                    failCount,
                    exportFileCount: countExportedDetailFiles(exportResult),
                    blockers: failCount > 0 ? [`${failCount} 屏填充失败或缺少可执行计划。`] : [],
                    warnings: [
                        ...degradedScreenNames.map((name) => `${name}: 降级填充`),
                        ...anchorDiagnostics.warnings.map((warning) => String(warning)),
                        ...((placementAuditResult?.warnings || []) as any[]).map((warning) => String(warning))
                    ]
                }
            });
            const detailPageContentVerification = buildDetailPageContentVerification({
                state: designProjectState,
                screenPlans: liveScreenPlans,
                fillPlans: executedFillPlans,
                executionResults: Array.from(resultByScreenId.entries()).map(([screenId, status]) => ({
                    screenId,
                    status
                }))
            });
            emitStep(
                'finalizing',
                '详情页执行结果已汇总',
                `成功 ${successCount} 屏，失败 ${failCount} 屏，复核等级 ${reviewLevel}。`,
                failCount === 0 ? 'success' : 'error',
                1
            );

            return {
                success: failCount === 0,
                message: buildExecutionSummary({
                    screens: liveScreens,
                    screenPlans,
                    readiness,
                    layoutAssessment,
                    visualPlanning,
                    focus,
                    anchorDiagnostics,
                    placementAudit: placementAuditResult,
                    copyLayoutAudit: liveCopyLayoutAudit,
                    copyGenerationSummary,
                    livePlacementDiagnostics: {
                        placementCount: livePlacementDiagnostics.placementCount,
                        unmatchedPlaceholderCount: livePlacementDiagnostics.unmatchedPlaceholderCount
                    },
                    reviewLevel,
                    successCount,
                    failCount,
                    degradedScreenNames,
                    phaseDurations,
                    exportResult,
                    totalTime: Date.now() - startedAt
                }),
                toolResults: results,
                data: {
                    inspectOnly: false,
                    reviewLevel,
                    needsReview,
                    readiness,
                    layoutGraphs,
                    layoutAssessment,
                    screenPlans,
                    screenPlanLines: screenPlans.map(formatScreenPlanLine),
                    projectStateContext,
                    visualPlanning,
                    focus,
                    imageFit: {
                        decisionCount: plannedContent.fitDecisionCount
                    },
                    copyLayoutAudit: {
                        template: templateCopyAudit,
                        projected: projectedCopyAudit,
                        live: liveCopyLayoutAudit
                    },
                    copyGenerationSummary,
                    anchorDiagnostics,
                    placementAudit: placementAuditResult,
                    livePlacementDiagnostics,
                    structureAlerts,
                    export: exportResult,
                    screenSnapshots: snapshotResult?.screens || snapshotResult?.images || [],
                    phaseDurations,
                    detailPageAgentIntake,
                    detailPageAgentResultSummary,
                    detailPageContentVerification,
                    detailPageSkillReadiness,
                    businessSkillMemoryContext: designPlanner.businessSkillMemoryContext,
                    businessSkillMemoryStrategy: designPlanner.businessSkillMemoryStrategy,
                    detailPageMemoryStrategy: designPlanner.detailPageMemoryStrategy,
                    ecommerceSocksChildStrategyInput: designPlanner.ecommerceSocksChildStrategyInput,
                    detailPageDesignPlacementIntelligence: designPlanner.detailPageDesignPlacementIntelligence,
                    businessSkillDesignPlacementIntelligence: designPlanner.businessSkillDesignPlacementIntelligence,
                    designAgentOs,
                    designPlanner,
                    stats: {
                        screensProcessed: liveScreens.length,
                        screensSuccess: successCount,
                        screensFailed: failCount,
                        degradedScreenCount: degradedScreenNames.length
                    }
                }
            };
        } catch (error: any) {
            const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                intake: detailPageAgentIntake,
                runtime: {
                    success: false,
                    blockers: [error?.message || '未知错误'],
                    warnings: detailPageAgentIntake.warnings
                }
            });
            emitStep(
                'warning',
                '详情页执行异常',
                error?.message || '未知错误',
                'error',
                1
            );
            return buildFailureResult(
                `详情页执行失败: ${error?.message || '未知错误'}`,
                error?.message || 'Unknown error',
                results,
                {
                    detailPageAgentIntake,
                    detailPageAgentResultSummary,
                    detailPageSkillReadiness: detailPageAgentIntake.readiness
                }
            );
        }
    }
};
