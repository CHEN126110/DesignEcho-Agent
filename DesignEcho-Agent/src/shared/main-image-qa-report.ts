import type {
    DesignAgentOsStatus,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type { MainImageAgentDraftPlan } from './main-image-agent-draft-plan';
import type { MainImageCandidatePreflightPlan } from './main-image-asset-selection';
import type { MainImageExecutionAlignment } from './main-image-execution-alignment';
import type { MainImageScreenshotProbeReadiness } from './main-image-screenshot-probe-readiness';
import type { MainImageScreenshotQa } from './main-image-screenshot-qa';
import type { MainImageVisionPreflightResult } from './main-image-vision-preflight';

export type MainImageQaReportStage =
    | 'needs_context'
    | 'needs_result_image'
    | 'needs_probe_target'
    | 'needs_pixel_probe'
    | 'needs_manual_review'
    | 'passed'
    | 'blocked';

export interface MainImageQaReportSection {
    id: string;
    label: string;
    status: DesignAgentOsStatus;
    summary: string;
    details: string[];
}

export interface MainImageQaReportQualityClaim {
    allowed: boolean;
    reason: string;
    requiredChecks: string[];
    blockers: string[];
    boundary: string;
}

export interface MainImageQaReportResultImageSummary {
    resultImageCount: number;
    resultImageNames: string[];
    fileProbeCount: number;
    okFileProbeCount: number;
    targetMode: string;
    pixelProbeStatus: string;
    manualReviewDecision: string;
}

export interface MainImageQaReportRedaction {
    rawImagesRedacted: true;
    pathsRedacted: boolean;
    pathPolicy: string;
}

export interface MainImageQaReport {
    reportVersion: 'main-image-qa-report/v0';
    scenario: 'main-image';
    status: DesignAgentOsStatus;
    stage: MainImageQaReportStage;
    summary: string;
    sections: MainImageQaReportSection[];
    resultImageSummary: MainImageQaReportResultImageSummary;
    qualityClaim: MainImageQaReportQualityClaim;
    checks: VerificationCheck[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    nextActions: string[];
    redaction: MainImageQaReportRedaction;
    verificationReport: VerificationReport;
}

export interface MainImageQaReportInput {
    agentDraft?: MainImageAgentDraftPlan | null;
    candidatePreflight?: MainImageCandidatePreflightPlan | null;
    visionPreflight?: MainImageVisionPreflightResult | null;
    executionAlignment?: MainImageExecutionAlignment | null;
    screenshotQa?: MainImageScreenshotQa | null;
    screenshotProbeReadiness?: MainImageScreenshotProbeReadiness | null;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function basename(value: unknown): string {
    const text = cleanString(value).replace(/\\/g, '/');
    if (!text) return '';
    return text.split('/').filter(Boolean).pop() || text;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function makeSection(
    id: string,
    label: string,
    status: DesignAgentOsStatus,
    summary: string,
    details: string[] = []
): MainImageQaReportSection {
    return {
        id,
        label,
        status,
        summary,
        details: uniqueStrings(details).slice(0, 8)
    };
}

function sectionStatusFromBoolean(value: boolean, fallback: DesignAgentOsStatus = 'needs_review'): DesignAgentOsStatus {
    return value ? 'passed' : fallback;
}

function statusFromAgentDraft(draft: MainImageAgentDraftPlan | null | undefined): DesignAgentOsStatus {
    if (!draft) return 'not_run';
    return draft.readiness === 'ready' ? 'passed' : 'needs_review';
}

function statusFromCandidatePreflight(preflight: MainImageCandidatePreflightPlan | null | undefined): DesignAgentOsStatus {
    if (!preflight) return 'not_run';
    if (preflight.status === 'blocked') return 'failed';
    return 'needs_review';
}

function buildResultImageSummary(input: MainImageQaReportInput): MainImageQaReportResultImageSummary {
    const resultPaths = input.screenshotQa?.resultImageRecord?.resultPaths || [];
    const fileProbes = input.screenshotProbeReadiness?.resultFileProbes || [];
    return {
        resultImageCount: resultPaths.length,
        resultImageNames: uniqueStrings(resultPaths.map(basename)).slice(0, 12),
        fileProbeCount: fileProbes.length,
        okFileProbeCount: fileProbes.filter((probe) => probe.status === 'ok' && probe.rawImagesRedacted === true).length,
        targetMode: cleanString(input.screenshotProbeReadiness?.probeTarget?.mode) || 'unknown',
        pixelProbeStatus: cleanString(input.screenshotQa?.pixelProbe?.status || input.screenshotProbeReadiness?.pixelProbe?.status) || 'none',
        manualReviewDecision: cleanString(input.screenshotQa?.manualReview?.decision) || 'none'
    };
}

function collectBlockers(input: MainImageQaReportInput): string[] {
    return uniqueStrings([
        ...(input.agentDraft?.blockers || []),
        ...(input.candidatePreflight?.blockers || []),
        ...(input.executionAlignment?.blockers || []),
        ...(input.screenshotQa?.blockers || []),
        ...(input.screenshotProbeReadiness?.blockers || [])
    ]);
}

function collectWarnings(input: MainImageQaReportInput): string[] {
    return uniqueStrings([
        ...(input.agentDraft?.warnings || []),
        ...(input.candidatePreflight?.warnings || []),
        ...(input.visionPreflight?.warnings || []),
        ...(input.executionAlignment?.warnings || []),
        ...(input.screenshotQa?.warnings || []),
        ...(input.screenshotProbeReadiness?.warnings || [])
    ]);
}

function inferStage(input: MainImageQaReportInput, blockers: string[]): MainImageQaReportStage {
    if (blockers.length > 0) return 'blocked';
    if (input.candidatePreflight?.status === 'blocked') return 'blocked';
    if (input.executionAlignment?.status === 'blocked') return 'blocked';
    if (input.screenshotQa?.stage === 'blocked') return 'blocked';
    if (input.screenshotProbeReadiness?.stage === 'blocked') return 'blocked';
    if (!input.agentDraft || input.agentDraft.readiness !== 'ready') return 'needs_context';
    if (!input.screenshotQa || input.screenshotQa.stage === 'needs_result_image') return 'needs_result_image';
    if (input.screenshotProbeReadiness?.stage === 'needs_probe_target') return 'needs_probe_target';
    if (
        input.screenshotQa.stage === 'needs_pixel_probe'
        || input.screenshotProbeReadiness?.stage === 'ready_for_pixel_probe'
    ) return 'needs_pixel_probe';
    if (
        input.screenshotQa.stage === 'needs_manual_review'
        || input.screenshotProbeReadiness?.stage === 'needs_manual_review'
    ) return 'needs_manual_review';
    if (input.screenshotQa.stage === 'passed' && input.screenshotProbeReadiness?.stage === 'passed') return 'passed';
    return 'needs_manual_review';
}

function statusForStage(stage: MainImageQaReportStage): DesignAgentOsStatus {
    if (stage === 'passed') return 'passed';
    if (stage === 'blocked') return 'failed';
    return 'needs_review';
}

function buildQualityClaim(
    input: MainImageQaReportInput,
    stage: MainImageQaReportStage,
    blockers: string[]
): MainImageQaReportQualityClaim {
    const requiredChecks = [
        'agentDraft.readiness=ready',
        'executionAlignment.status=aligned 或无阻断项',
        'screenshotQa.stage=passed',
        'screenshotProbeReadiness.stage=passed',
        'pixelProbe.status=ok',
        'manualReview.decision=approved',
        'rawImagesRedacted=true'
    ];
    const localBlockers = [...blockers];
    if (input.agentDraft?.readiness !== 'ready') localBlockers.push('主图 Agent 草案仍缺少上下文或存在阻断。');
    if (input.executionAlignment?.status === 'blocked') localBlockers.push('主图执行对齐存在阻断项。');
    if (input.screenshotQa?.stage !== 'passed') localBlockers.push('截图 QA 尚未通过。');
    if (input.screenshotProbeReadiness?.stage !== 'passed') localBlockers.push('截图探针就绪链路尚未通过。');
    if (input.screenshotQa?.pixelProbe?.status !== 'ok') localBlockers.push('pixel probe 不是 ok。');
    if (input.screenshotQa?.manualReview?.decision !== 'approved') localBlockers.push('缺少人工 approved 复核。');
    if (input.screenshotQa?.pixelProbe && input.screenshotQa.pixelProbe.rawImagesRedacted !== true) {
        localBlockers.push('pixel probe 未保持 rawImagesRedacted=true。');
    }

    const uniqueBlockers = uniqueStrings(localBlockers);
    const allowed = stage === 'passed' && uniqueBlockers.length === 0;
    return {
        allowed,
        reason: allowed
            ? '主图 QA 报告具备结果图、脱敏 pixel probe 和人工 approved 结果。'
            : '当前检查结果不足以声明主图设计质量通过。',
        requiredChecks,
        blockers: uniqueBlockers,
        boundary: 'qualityClaim 只表示检查链可进入人工确认后的质量声明，不是模型自动审美评分。'
    };
}

function buildSections(input: MainImageQaReportInput): MainImageQaReportSection[] {
    const resultSummary = buildResultImageSummary(input);
    return [
        makeSection(
            'context',
            '任务上下文',
            statusFromAgentDraft(input.agentDraft),
            input.agentDraft
                ? `draft=${input.agentDraft.readiness}; asset=${input.agentDraft.selectedAssetStrategy.mode}; sizePlans=${input.agentDraft.layoutStrategy.sizePlanCount}`
                : '没有主图 Agent 草案。',
            [
                input.agentDraft?.selectedAssetStrategy.reason || '',
                input.agentDraft?.copyStrategy.reason || ''
            ]
        ),
        makeSection(
            'asset-preflight',
            '素材预检',
            statusFromCandidatePreflight(input.candidatePreflight),
            input.candidatePreflight
                ? `candidatePreflight=${input.candidatePreflight.status}; candidates=${input.candidatePreflight.candidateCount}; analyzer=${input.candidatePreflight.shouldCallAnalyzer}`
                : '没有素材候选预检结果。',
            input.candidatePreflight?.limitations || []
        ),
        makeSection(
            'vision-preflight',
            '视觉预检',
            input.visionPreflight?.resultStatus === 'succeeded'
                ? 'passed'
                : input.visionPreflight?.resultStatus === 'failed'
                    ? 'needs_review'
                    : input.visionPreflight ? 'needs_review' : 'not_run',
            input.visionPreflight
                ? `vision=${input.visionPreflight.resultStatus}; enabled=${input.visionPreflight.enabled}`
                : '没有视觉预检结果；默认不调用视觉模型。',
            [
                input.visionPreflight?.reason || '',
                input.visionPreflight?.visionSignal?.subjectSummary || '',
                ...(input.visionPreflight?.limitations || [])
            ]
        ),
        makeSection(
            'execution-alignment',
            '执行对齐',
            input.executionAlignment?.status === 'aligned'
                ? 'passed'
                : input.executionAlignment?.status === 'blocked'
                    ? 'failed'
                    : input.executionAlignment ? 'needs_review' : 'not_run',
            input.executionAlignment
                ? `alignment=${input.executionAlignment.status}; tools=${input.executionAlignment.successfulToolCallCount}/${input.executionAlignment.toolCallCount}`
                : '没有主图计划与工具结果对齐结果。',
            input.executionAlignment?.limitations || []
        ),
        makeSection(
            'result-image',
            '结果图记录',
            sectionStatusFromBoolean(resultSummary.resultImageCount > 0),
            `resultImages=${resultSummary.resultImageCount}; fileProbes=${resultSummary.okFileProbeCount}/${resultSummary.fileProbeCount}; target=${resultSummary.targetMode}`,
            [
                resultSummary.resultImageNames.length ? `resultImageNames=${resultSummary.resultImageNames.join(', ')}` : '',
                ...(input.screenshotProbeReadiness?.limitations || [])
            ]
        ),
        makeSection(
            'pixel-probe',
            '像素探针',
            resultSummary.pixelProbeStatus === 'ok'
                ? 'passed'
                : resultSummary.pixelProbeStatus === 'watch'
                    ? 'needs_review'
                    : 'not_run',
            `pixelProbe=${resultSummary.pixelProbeStatus}; manual=${resultSummary.manualReviewDecision}`,
            [
                input.screenshotQa?.pixelProbe?.summary || '',
                input.screenshotQa?.pixelProbe?.boundary || '',
                'pixel probe 是粗粒度诊断，不是高保真或审美评分。'
            ]
        ),
        makeSection(
            'manual-review',
            '人工复核',
            resultSummary.manualReviewDecision === 'approved'
                ? 'passed'
                : resultSummary.manualReviewDecision === 'rejected'
                    ? 'failed'
                    : 'not_run',
            `manualReview=${resultSummary.manualReviewDecision}`,
            [
                input.screenshotQa?.manualReview?.reviewer ? `reviewer=${input.screenshotQa.manualReview.reviewer}` : '',
                typeof input.screenshotQa?.manualReview?.score === 'number' ? `score=${input.screenshotQa.manualReview.score}` : ''
            ]
        )
    ];
}

function buildChecks(sections: MainImageQaReportSection[], qualityClaim: MainImageQaReportQualityClaim): VerificationCheck[] {
    return [
        ...sections.map((section) => ({
            id: `main-image-qa-${section.id}`,
            label: section.label,
            status: section.status,
            summary: section.summary
        })),
        {
            id: 'main-image-qa-quality-claim',
            label: '质量声明门禁',
            status: qualityClaim.allowed ? 'passed' : 'needs_review',
            summary: qualityClaim.reason
        }
    ];
}

function buildNextActions(stage: MainImageQaReportStage, qualityClaim: MainImageQaReportQualityClaim): string[] {
    if (stage === 'passed') return ['可进入人工验收记录或后续导出交付流程。'];
    if (stage === 'blocked') return qualityClaim.blockers.slice(0, 5);
    if (stage === 'needs_context') return ['补充或确认主图素材、当前 Photoshop 文档、主体 bounds 和基础商品事实。'];
    if (stage === 'needs_result_image') return ['完成主图导出或提供可复核的结果图路径。'];
    if (stage === 'needs_probe_target') return ['提供明确 referenceImagePath，或指定可用于像素探针的参考图。'];
    if (stage === 'needs_pixel_probe') return ['对参考图和结果图运行脱敏 pixel probe；仍不能跳过人工复核。'];
    return ['请人工查看主图结果图，并记录 approved / rejected 与必要备注。'];
}

export function buildMainImageQaReport(input: MainImageQaReportInput): MainImageQaReport {
    const blockers = collectBlockers(input);
    const warnings = collectWarnings(input);
    const stage = inferStage(input, blockers);
    const status = statusForStage(stage);
    const resultImageSummary = buildResultImageSummary(input);
    const qualityClaim = buildQualityClaim(input, stage, blockers);
    const sections = buildSections(input);
    const checks = buildChecks(sections, qualityClaim);
    const limitations = [
        'mainImageQaReport 只汇总已有主图检查结果，不执行 Photoshop，不调用视觉模型，不修改设计结果。',
        '报告中的路径只保留文件名摘要；不会返回 raw image、base64、原始像素数据或 buffer。',
        '文件探针、尺寸、hash 和 pixel probe 只能提供部分技术检查结果，不等于审美验收。',
        '只有截图 QA passed、pixelProbe=ok、manualReview=approved 且无脱敏阻断时，qualityClaim 才允许为 true。'
    ];
    const verificationReport: VerificationReport = {
        reportId: 'main-image-qa-report',
        scenario: 'main-image',
        status,
        scope: 'task',
        summary: qualityClaim.allowed
            ? '主图 QA 报告具备质量声明所需检查结果。'
            : `主图 QA 报告阶段为 ${stage}，仍不能声明设计质量通过。`,
        checks,
        blockers: qualityClaim.blockers,
        warnings,
        limitations
    };

    return {
        reportVersion: 'main-image-qa-report/v0',
        scenario: 'main-image',
        status,
        stage,
        summary: verificationReport.summary,
        sections,
        resultImageSummary,
        qualityClaim,
        checks,
        blockers: qualityClaim.blockers,
        warnings,
        limitations,
        nextActions: buildNextActions(stage, qualityClaim),
        redaction: {
            rawImagesRedacted: true,
            pathsRedacted: true,
            pathPolicy: 'Only result image basenames and counts are exposed in this report.'
        },
        verificationReport
    };
}
