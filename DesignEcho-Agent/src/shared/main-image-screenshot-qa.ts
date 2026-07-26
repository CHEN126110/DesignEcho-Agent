import type {
    DesignAgentOsStatus,
    MainImageSizePlan,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type {
    MainImageManualReviewRecord,
    MainImageVisualVerification
} from './main-image-visual-loop';
import type { MainImageExecutionAlignment } from './main-image-execution-alignment';

export type MainImageScreenshotQaStage =
    | 'needs_result_image'
    | 'needs_pixel_probe'
    | 'needs_manual_review'
    | 'passed'
    | 'blocked';

export interface MainImageScreenshotProbeObservation {
    mode: 'pixel-probe' | 'vision-review' | 'manual' | 'unknown';
    status: 'ok' | 'watch' | 'unverified';
    mae?: number;
    rmse?: number;
    highDeltaRatio?: number;
    darkJaccard?: number;
    softDarkJaccard?: number;
    summary?: string;
    boundary?: string;
    rawImagesRedacted?: boolean;
}

export interface MainImageResultImageRecord {
    plannedExportCount: number;
    successfulExportCount: number;
    resultPaths: string[];
    missingOutputPathCount: number;
    sources: string[];
}

export interface MainImageScreenshotQa {
    qaVersion: 'main-image-screenshot-qa/v0';
    scenario: 'main-image';
    status: DesignAgentOsStatus;
    stage: MainImageScreenshotQaStage;
    resultImageRecord: MainImageResultImageRecord;
    pixelProbe?: MainImageScreenshotProbeObservation;
    manualReview?: MainImageManualReviewRecord;
    checks: VerificationCheck[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    verificationReport: VerificationReport;
}

export interface MainImageScreenshotQaInput {
    sizePlans?: MainImageSizePlan[];
    toolResults?: Array<{ toolName?: string; result?: any }>;
    visualVerification?: MainImageVisualVerification | null;
    executionAlignment?: MainImageExecutionAlignment | null;
    resultImageRecord?: Partial<MainImageResultImageRecord> | null;
    pixelProbe?: MainImageScreenshotProbeObservation | null;
    manualReview?: MainImageManualReviewRecord | null;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizeToolName(value: unknown): string {
    return cleanString(value).replace(/\[.*?\]/g, '').toLowerCase();
}

function isToolSuccess(result: any): boolean {
    if (!result) return false;
    if (result.success === false) return false;
    if (typeof result.error === 'string' && result.error.trim()) return false;
    return result.success === true || Object.keys(result).length > 0;
}

function extractOutputPath(result: any): string {
    return cleanString(
        result?.outputPath
        || result?.path
        || result?.filePath
        || result?.resultPath
    );
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function cleanCount(value: unknown): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
    return Math.floor(numberValue);
}

function buildResultImageRecord(input: MainImageScreenshotQaInput): MainImageResultImageRecord {
    const sizePlans = input.sizePlans || [];
    const toolResults = input.toolResults || [];
    const explicitRecord = input.resultImageRecord || {};
    const explicitPaths = Array.isArray(explicitRecord.resultPaths)
        ? explicitRecord.resultPaths.map(cleanString).filter(Boolean)
        : [];
    const explicitSources = Array.isArray(explicitRecord.sources)
        ? explicitRecord.sources.map(cleanString).filter(Boolean)
        : [];
    const explicitPlannedExportCount = cleanCount(explicitRecord.plannedExportCount);
    const explicitSuccessfulExportCount = Math.max(
        cleanCount(explicitRecord.successfulExportCount),
        explicitPaths.length
    );
    const explicitMissingOutputPathCount = cleanCount(explicitRecord.missingOutputPathCount);
    const plannedExportCount = sizePlans.filter((plan) => plan.quickExportPlanned).length;
    const successfulQuickExportResults = toolResults.filter((entry) => (
        /^quickexport/.test(normalizeToolName(entry?.toolName))
        && isToolSuccess(entry?.result)
    ));
    const pathsFromPlans = sizePlans
        .map((plan) => plan.quickExportOutputPath)
        .map(cleanString)
        .filter(Boolean);
    const pathsFromTools = successfulQuickExportResults
        .map((entry) => extractOutputPath(entry?.result))
        .filter(Boolean);
    const visualPath = cleanString(input.visualVerification?.screenshotObservation?.resultPath);
    const resultPaths = uniqueStrings([
        ...pathsFromPlans,
        ...pathsFromTools,
        visualPath,
        ...explicitPaths
    ]);
    const missingOutputPathCount = successfulQuickExportResults
        .filter((entry) => !extractOutputPath(entry?.result))
        .length + explicitMissingOutputPathCount;

    return {
        plannedExportCount: plannedExportCount + explicitPlannedExportCount,
        successfulExportCount: successfulQuickExportResults.length + explicitSuccessfulExportCount,
        resultPaths,
        missingOutputPathCount,
        sources: uniqueStrings([
            pathsFromPlans.length > 0 ? 'sizePlan.quickExportOutputPath' : '',
            pathsFromTools.length > 0 ? 'quickExport.toolResult.outputPath' : '',
            visualPath ? 'visualVerification.screenshotObservation.resultPath' : '',
            ...explicitSources
        ])
    };
}

function checkStatus(condition: boolean, pass: DesignAgentOsStatus, fail: DesignAgentOsStatus): DesignAgentOsStatus {
    return condition ? pass : fail;
}

export function buildMainImageScreenshotQa(input: MainImageScreenshotQaInput): MainImageScreenshotQa {
    const resultImageRecord = buildResultImageRecord(input);
    const pixelProbe = input.pixelProbe || undefined;
    const manualReview = input.manualReview || input.visualVerification?.manualReview || undefined;
    const blockers: string[] = [];
    const warnings: string[] = [];

    const hasPlannedExport = resultImageRecord.plannedExportCount > 0;
    const hasResultImage = resultImageRecord.resultPaths.length > 0;
    const hasPixelProbe = Boolean(pixelProbe);
    const manualDecision = manualReview?.decision;

    if (hasPlannedExport && resultImageRecord.successfulExportCount === 0) {
        blockers.push('主图计划要求导出，但没有 quickExport 成功结果。');
    }
    if (hasPlannedExport && resultImageRecord.successfulExportCount > 0 && !hasResultImage) {
        warnings.push('quickExport 返回成功，但没有可复核的输出路径。');
    }
    if (!hasPlannedExport && !hasResultImage) {
        warnings.push('当前主图任务没有结果图或导出结果，不能进行截图级 QA。');
    }
    if (hasResultImage && !hasPixelProbe) {
        warnings.push('已有结果图路径，但没有 pixel probe 或等价截图检查结果。');
    }
    if (pixelProbe && pixelProbe.rawImagesRedacted !== true) {
        blockers.push('截图 QA 记录必须保持 rawImagesRedacted=true，不能把原始图像数据写入报告。');
    }
    if (pixelProbe?.status === 'watch') {
        warnings.push('pixel probe 结果为 watch，只能作为观察项，不能声明主图设计质量通过。');
    }
    if (pixelProbe?.status === 'unverified') {
        warnings.push('pixel probe 未完成，截图相似度仍未验证。');
    }
    if (hasResultImage && !manualDecision) {
        warnings.push('已有结果图或截图，但缺少人工复核结论。');
    }
    if (manualDecision === 'rejected') {
        blockers.push('人工复核拒绝当前主图结果。');
    }
    if (input.executionAlignment?.status === 'blocked') {
        warnings.push('执行对齐仍存在阻断项，截图 QA 不应单独覆盖执行结果问题。');
    }

    let stage: MainImageScreenshotQaStage = 'needs_result_image';
    if (blockers.length > 0) stage = 'blocked';
    else if (!hasResultImage) stage = 'needs_result_image';
    else if (!hasPixelProbe || pixelProbe?.status !== 'ok') stage = 'needs_pixel_probe';
    else if (manualDecision !== 'approved') stage = 'needs_manual_review';
    else stage = 'passed';

    const status: DesignAgentOsStatus = stage === 'passed'
        ? 'passed'
        : stage === 'blocked'
            ? 'failed'
            : 'needs_review';

    const checks: VerificationCheck[] = [
        {
            id: 'main-image-result-image',
            label: '结果图记录',
            status: hasResultImage ? 'needs_review' : checkStatus(!hasPlannedExport, 'not_run', 'failed'),
            summary: hasResultImage
                ? `发现 ${resultImageRecord.resultPaths.length} 个结果图路径。`
                : hasPlannedExport
                    ? '计划导出主图，但没有结果图路径。'
                    : '未计划导出，也没有结果图记录。'
        },
        {
            id: 'main-image-pixel-probe',
            label: '截图像素探针',
            status: pixelProbe?.status === 'ok'
                ? 'passed'
                : pixelProbe?.status === 'watch'
                    ? 'needs_review'
                    : 'not_run',
            summary: pixelProbe
                ? `${pixelProbe.mode}=${pixelProbe.status}; ${pixelProbe.summary || pixelProbe.boundary || '无摘要'}`
                : '没有 pixel probe 或等价截图检查结果。'
        },
        {
            id: 'main-image-manual-review',
            label: '人工复核',
            status: manualDecision === 'approved'
                ? 'passed'
                : manualDecision === 'rejected'
                    ? 'failed'
                    : 'not_run',
            summary: manualDecision
                ? `manual=${manualDecision}; score=${manualReview?.score ?? 'unknown'}。`
                : '没有人工复核结论。'
        },
        {
            id: 'main-image-quality-boundary',
            label: '质量声明边界',
            status: stage === 'passed' ? 'passed' : 'needs_review',
            summary: stage === 'passed'
                ? '截图 QA 具备结果图、pixel probe=ok 和人工通过结论。'
                : '当前检查结果不足以声明主图设计质量通过。'
        }
    ];

    const limitations = [
        'mainImageScreenshotQa 是结果图 QA 检查层，不会读取或暴露原始图片数据。',
        'pixel probe 只能做粗粒度截图相似/结构检查，不是审美评分器。',
        '没有结果图、pixel probe=ok 和人工通过三者同时存在时，不能声明主图设计质量通过。',
        '该报告不改变 Photoshop 工具参数、执行顺序、导出逻辑或成功判定。'
    ];
    const verificationReport: VerificationReport = {
        reportId: 'main-image-screenshot-qa',
        scenario: 'main-image',
        status,
        scope: 'screenshot',
        summary: stage === 'passed'
            ? '主图截图 QA 已具备结果图、pixel probe 和人工通过结果。'
            : `主图截图 QA 阶段为 ${stage}，仍不能声明设计质量通过。`,
        checks,
        blockers,
        warnings,
        limitations
    };

    return {
        qaVersion: 'main-image-screenshot-qa/v0',
        scenario: 'main-image',
        status,
        stage,
        resultImageRecord,
        pixelProbe,
        manualReview,
        checks,
        blockers,
        warnings,
        limitations,
        verificationReport
    };
}
