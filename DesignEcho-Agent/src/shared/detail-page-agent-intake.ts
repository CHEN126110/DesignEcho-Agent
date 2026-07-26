import type { DetailPageSkillReadiness } from './detail-page-skill-readiness';
import { buildDetailPageSkillReadiness } from './detail-page-skill-readiness';

export type DetailPageAgentMode = 'inspect' | 'execute';
export type DetailPageAgentRecommendedAction =
    | 'inspect_template'
    | 'execute_with_review'
    | 'request_context'
    | 'stop';
export type DetailPageAgentResultStatus = 'completed' | 'needs_review' | 'blocked' | 'failed';

export interface DetailPageAgentIntakeInput {
    params?: Record<string, any> | null;
    context?: {
        userInput?: string;
        projectContext?: any;
    } | null;
}

export interface DetailPageAgentIntake {
    intakeVersion: 'detail-page-agent-intake/v0';
    mode: DetailPageAgentMode;
    canStart: boolean;
    recommendedAction: DetailPageAgentRecommendedAction;
    params: Record<string, any>;
    blockers: string[];
    warnings: string[];
    requiredNextChecks: string[];
    readiness: DetailPageSkillReadiness;
    userIntent: string;
    projectPath: string;
    agentReadableText: string;
}

export interface DetailPageAgentResultSummaryInput {
    intake: DetailPageAgentIntake;
    runtime: {
        success?: boolean;
        reviewLevel?: string;
        screenCount?: number;
        successCount?: number;
        failCount?: number;
        exportFileCount?: number;
        blockers?: string[];
        warnings?: string[];
    };
}

export interface DetailPageAgentResultSummary {
    summaryVersion: 'detail-page-agent-result-summary/v0';
    status: DetailPageAgentResultStatus;
    recommendedAction: DetailPageAgentRecommendedAction;
    nextStep: string;
    agentReadableText: string;
    blockers: string[];
    warnings: string[];
}

const INSPECT_PATTERN = /(检查|分析|结构|模板|看一下|看看|复核|诊断|inspect|review|analy[sz]e|structure)/iu;
const EXECUTE_PATTERN = /(设计|填充|生成|制作|整理|处理|换图|排版|出图|导出|切片|design|fill|generate|export)/iu;
const EXPORT_PATTERN = /(导出|出图|切片|输出|export|slice)/iu;

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function toNumber(value: unknown): number {
    const numberValue = Number(value || 0);
    return Number.isFinite(numberValue) ? numberValue : 0;
}

function resolveMode(params: Record<string, any>, userIntent: string): DetailPageAgentMode {
    const explicitAgentMode = normalizeText(params.agentMode || params.mode || '').toLowerCase();
    if (explicitAgentMode === 'inspect') return 'inspect';
    if (explicitAgentMode === 'execute' || explicitAgentMode === 'export') return 'execute';
    if (params.inspectOnly === true || normalizeText(params.structureMode).toLowerCase() === 'inspect') return 'inspect';

    const asksExecute = EXECUTE_PATTERN.test(userIntent);
    const asksInspect = INSPECT_PATTERN.test(userIntent);
    if (asksInspect && !asksExecute) return 'inspect';
    return 'execute';
}

function wantsExport(params: Record<string, any>, userIntent: string): boolean {
    return params.exportSlices === true
        || params.autoExport === true
        || normalizeText(params.agentMode || params.mode).toLowerCase() === 'export'
        || EXPORT_PATTERN.test(userIntent);
}

function buildProjectContext(projectContext: any, projectPath: string) {
    const assetIndex = projectContext?.assetIndex || {};
    const visualSamplingPlan = projectContext?.visualSamplingPlan || {};
    const visualInsightCache = projectContext?.visualInsightCache || {};
    return {
        projectPathKnown: Boolean(projectPath || projectContext?.projectPath),
        assetImageCount: toNumber(assetIndex?.summary?.totalImages),
        visualCandidateCount: toNumber(assetIndex?.visionCandidates?.length),
        selectedCandidateCount: toNumber(visualSamplingPlan?.selectedCandidates?.length),
        visualInsightCount: toNumber(visualInsightCache?.summary?.entriesWithInsight),
        shouldAnalyzeCount: toNumber(visualSamplingPlan?.cacheSummary?.shouldAnalyze)
    };
}

function normalizeParams(input: {
    params: Record<string, any>;
    mode: DetailPageAgentMode;
    userIntent: string;
    projectPath: string;
}): Record<string, any> {
    const { params, mode, userIntent, projectPath } = input;
    const exportSlices = wantsExport(params, userIntent);
    return {
        ...params,
        userIntent,
        projectPath: normalizeText(params.projectPath) || projectPath,
        inspectOnly: mode === 'inspect',
        structureMode: mode === 'inspect'
            ? 'inspect'
            : (normalizeText(params.structureMode) || 'guided'),
        autoFix: mode === 'execute' ? params.autoFix !== false : false,
        planGuard: params.planGuard !== false,
        allowLowConfidenceFill: params.allowLowConfidenceFill === true,
        visualValidation: mode === 'execute'
            ? (params.visualValidation || (exportSlices ? 'screenshots' : 'snapshot'))
            : false,
        exportSlices,
        reviewPolicy: normalizeText(params.reviewPolicy) || 'review_required'
    };
}

function buildAgentReadableIntakeText(input: {
    mode: DetailPageAgentMode;
    canStart: boolean;
    recommendedAction: DetailPageAgentRecommendedAction;
    blockers: string[];
    warnings: string[];
}): string {
    const modeText = input.mode === 'inspect' ? '检查详情页模板结构' : '执行详情页设计/填充';
    if (!input.canStart) {
        return `${modeText}暂不能开始：${input.blockers[0] || '缺少必要上下文。'}`;
    }
    if (input.warnings.length > 0) {
        return `${modeText}可以开始，但需要复核：${input.warnings[0]}`;
    }
    return `${modeText}可以开始，建议动作：${input.recommendedAction}。`;
}

export function buildDetailPageAgentIntake(input: DetailPageAgentIntakeInput): DetailPageAgentIntake {
    const params = { ...(input.params || {}) };
    const context = input.context || {};
    const userIntent = normalizeText(params.userIntent || context.userInput);
    const projectContext = context.projectContext || {};
    const projectPath = normalizeText(params.projectPath || projectContext.projectPath);
    const mode = resolveMode(params, userIntent);
    const normalizedParams = normalizeParams({ params, mode, userIntent, projectPath });

    const readiness = buildDetailPageSkillReadiness({
        mode,
        template: null,
        project: buildProjectContext(projectContext, projectPath),
        imagePlacementCoreAvailable: true,
        verificationToolsAvailable: true
    });

    const blockers = mode === 'execute'
        ? unique(readiness.sections.projectVisualContext.blockers)
        : [];
    const warnings = mode === 'execute'
        ? unique([
            ...readiness.sections.projectVisualContext.warnings,
            ...readiness.sections.imagePlacement.warnings,
            ...readiness.sections.verification.warnings
        ])
        : [];
    const requiredNextChecks = mode === 'execute'
        ? unique(readiness.sections.projectVisualContext.requiredNextChecks)
        : [];
    const canStart = mode === 'inspect' || blockers.length === 0;
    const recommendedAction: DetailPageAgentRecommendedAction = mode === 'inspect'
        ? 'inspect_template'
        : canStart
            ? 'execute_with_review'
            : 'request_context';

    return {
        intakeVersion: 'detail-page-agent-intake/v0',
        mode,
        canStart,
        recommendedAction,
        params: normalizedParams,
        blockers,
        warnings,
        requiredNextChecks,
        readiness,
        userIntent,
        projectPath,
        agentReadableText: buildAgentReadableIntakeText({
            mode,
            canStart,
            recommendedAction,
            blockers,
            warnings
        })
    };
}

export function buildDetailPageAgentResultSummary(
    input: DetailPageAgentResultSummaryInput
): DetailPageAgentResultSummary {
    const runtime = input.runtime || {};
    const failCount = toNumber(runtime.failCount);
    const screenCount = toNumber(runtime.screenCount);
    const successCount = toNumber(runtime.successCount);
    const exportFileCount = toNumber(runtime.exportFileCount);
    const blockers = unique(runtime.blockers || input.intake.blockers);
    const warnings = unique(runtime.warnings || input.intake.warnings);
    const reviewLevel = normalizeText(runtime.reviewLevel);
    const status: DetailPageAgentResultStatus = runtime.success === false || failCount > 0
        ? (failCount > 0 ? 'needs_review' : 'failed')
        : reviewLevel && reviewLevel !== 'ok'
            ? 'needs_review'
            : 'completed';
    const nextStep = status === 'completed'
        ? (exportFileCount > 0 ? '确认导出文件和页面视觉效果。' : '复核当前 PSD 中每屏内容和图片区落位。')
        : status === 'needs_review'
            ? '复核失败屏、降级填充屏和图片落位风险后再继续。'
            : blockers[0] || '补齐详情页执行所需上下文后再继续。';

    return {
        summaryVersion: 'detail-page-agent-result-summary/v0',
        status,
        recommendedAction: status === 'completed'
            ? 'execute_with_review'
            : status === 'needs_review'
                ? 'execute_with_review'
                : 'request_context',
        nextStep,
        agentReadableText: `详情页处理结果：${successCount}/${screenCount || successCount} 屏完成，失败 ${failCount} 屏，复核状态 ${status}。${exportFileCount > 0 ? `导出 ${exportFileCount} 个文件。` : ''}`,
        blockers,
        warnings
    };
}
