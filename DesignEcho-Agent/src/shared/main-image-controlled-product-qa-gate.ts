import type {
    DesignAgentOsStatus,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type {
    MainImageLiveExecutorOperationRunResult,
    MainImageLiveExecutorReadbackRunResult,
    MainImageLiveExecutorRunResult
} from './main-image-live-executor-runner';
import type { MainImageScreenshotProbeObservation } from './main-image-screenshot-qa';
import type { MainImageResultFileProbe } from './main-image-screenshot-probe-readiness';
import type { MainImageManualReviewRecord } from './main-image-visual-loop';

export type MainImageControlledProductQaGateStage =
    | 'needs_runner'
    | 'needs_result_image'
    | 'needs_result_file_probe'
    | 'needs_probe_target'
    | 'needs_pixel_probe'
    | 'needs_manual_review'
    | 'passed'
    | 'blocked';

export interface MainImageControlledProductResultImageSummary {
    plannedExportCount: number;
    successfulExportCount: number;
    resultImageCount: number;
    resultImageNames: string[];
    missingOutputPathCount: number;
    sources: string[];
    finalSnapshotCaptured: boolean;
}

export interface MainImageControlledProductResultFileProbeSummary {
    fileProbeCount: number;
    okFileProbeCount: number;
    failedFileProbeCount: number;
    missingFileProbeCount: number;
    resultFileNames: string[];
    probeTargetMode: 'reference-image' | 'result-file-only' | 'unknown';
    referenceImageName?: string;
    rawImagesRedacted: boolean;
}

export interface MainImageControlledProductQualityClaim {
    allowed: false;
    reason: string;
    requiredChecks: string[];
    blockers: string[];
    boundary: string;
}

export interface MainImageControlledProductQaGateRedaction {
    rawImagesRedacted: true;
    pathsRedacted: true;
    pathPolicy: string;
}

export interface MainImageControlledProductQaGate {
    gateVersion: 'main-image-controlled-product-qa-gate/v0';
    scenario: 'main-image';
    status: DesignAgentOsStatus;
    stage: MainImageControlledProductQaGateStage;
    summary: string;
    runnerStatus: string;
    executedOperationCount: number;
    failedOperationCount: number;
    failedReadbackCount: number;
    resultImageSummary: MainImageControlledProductResultImageSummary;
    resultFileProbeSummary: MainImageControlledProductResultFileProbeSummary;
    pixelProbe?: MainImageScreenshotProbeObservation;
    manualReview?: MainImageManualReviewRecord;
    qualityClaim: MainImageControlledProductQualityClaim;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    requiresManualReviewBeforeQualityClaim: true;
    checks: VerificationCheck[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    nextActions: string[];
    redaction: MainImageControlledProductQaGateRedaction;
    verificationReport: VerificationReport;
}

export interface MainImageControlledProductQaGateInput {
    runner?: MainImageLiveExecutorRunResult | null;
    resultFileProbes?: MainImageResultFileProbe[] | null;
    referenceImagePath?: string | null;
    pixelProbe?: MainImageScreenshotProbeObservation | null;
    manualReview?: MainImageManualReviewRecord | null;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

const PATH_FIELD_PATTERN = /^(outputPath|path|filePath|resultPath|exportedPath|exportPath|targetPath|destinationPath)$/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /[A-Za-z]:[\\/][^\s"'<>|]+/g;
const IMAGE_RESULT_EXTENSION_PATTERN = /\.(png|jpe?g|webp|tiff?|psd)$/i;

function containsForbiddenPayload(value: string): boolean {
    return FORBIDDEN_PAYLOAD_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(value);
    });
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        pattern.lastIndex = 0;
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return redactPathsInText(text).replace(/\s+/g, ' ').trim();
}

function redactPathsInText(value: string): string {
    return value.replace(WINDOWS_ABSOLUTE_PATH_PATTERN, (match) => basename(match) || '[redacted-path]');
}

function basename(value: unknown): string {
    const text = String(value || '').trim().replace(/\\/g, '/');
    if (!text) return '';
    return text.split('/').filter(Boolean).pop() || text;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function cleanBlockers(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return uniqueStrings(values.map(cleanString));
}

function cleanNumber(value: unknown): number | undefined {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
}

function cleanBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function looksLikeResultPath(value: unknown): boolean {
    const text = String(value || '').trim();
    if (!text) return false;
    if (containsForbiddenPayload(text)) return false;
    return IMAGE_RESULT_EXTENSION_PATTERN.test(text) || /[\\/]/.test(text);
}

function collectPathValues(value: unknown, source: string, output: Array<{ path: string; source: string }>): void {
    if (typeof value === 'string') {
        if (looksLikeResultPath(value)) output.push({ path: value, source });
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectPathValues(item, source, output);
        return;
    }
    if (!isRecord(value)) return;

    for (const [key, item] of Object.entries(value)) {
        if (/raw|base64|imageData|binary|buffer|thumbnail|preview/i.test(key)) {
            continue;
        }
        if (PATH_FIELD_PATTERN.test(key) && looksLikeResultPath(item)) {
            output.push({ path: String(item), source });
            continue;
        }
        if (isRecord(item) || Array.isArray(item)) {
            collectPathValues(item, source, output);
        }
    }
}

function operationToolName(operation: MainImageLiveExecutorOperationRunResult): string {
    return cleanString(operation.tool).toLowerCase();
}

function readbackSource(readback: MainImageLiveExecutorReadbackRunResult, parentSource: string): string {
    return `${parentSource}.${cleanString(readback.toolName) || 'readback'}`;
}

function sanitizeResultFileProbe(value: MainImageResultFileProbe): MainImageResultFileProbe {
    const status = value.status === 'ok'
        || value.status === 'missing'
        || value.status === 'not_file'
        || value.status === 'unsupported'
        || value.status === 'decode_failed'
        || value.status === 'unavailable'
        ? value.status
        : 'unavailable';
    return {
        path: basename(value.path),
        status,
        exists: cleanBoolean(value.exists),
        isFile: cleanBoolean(value.isFile),
        byteLength: cleanNumber(value.byteLength),
        format: cleanString(value.format) || undefined,
        dimensions: value.dimensions?.width && value.dimensions?.height
            ? {
                width: Number(value.dimensions.width),
                height: Number(value.dimensions.height)
            }
            : undefined,
        sha256: cleanString(value.sha256) || undefined,
        error: cleanString(value.error) || undefined,
        rawImagesRedacted: value.rawImagesRedacted === true
    };
}

function sanitizePixelProbe(
    value: MainImageScreenshotProbeObservation | null | undefined
): MainImageScreenshotProbeObservation | undefined {
    if (!value) return undefined;
    const mode = value.mode === 'pixel-probe' || value.mode === 'vision-review' || value.mode === 'manual'
        ? value.mode
        : 'unknown';
    const status = value.status === 'ok' || value.status === 'watch'
        ? value.status
        : 'unverified';
    return {
        mode,
        status,
        mae: cleanNumber(value.mae),
        rmse: cleanNumber(value.rmse),
        highDeltaRatio: cleanNumber(value.highDeltaRatio),
        darkJaccard: cleanNumber(value.darkJaccard),
        softDarkJaccard: cleanNumber(value.softDarkJaccard),
        summary: cleanString(value.summary) || undefined,
        boundary: cleanString(value.boundary) || undefined,
        rawImagesRedacted: value.rawImagesRedacted === true
    };
}

function sanitizeManualReview(
    value: MainImageManualReviewRecord | null | undefined
): MainImageManualReviewRecord | undefined {
    if (!value) return undefined;
    const decision = value.decision === 'approved' || value.decision === 'needs_review' || value.decision === 'rejected'
        ? value.decision
        : undefined;
    return {
        decision,
        score: cleanNumber(value.score),
        reviewer: cleanString(value.reviewer) || undefined,
        notes: uniqueStrings(value.notes || []).slice(0, 8)
    };
}

function extractPathEntries(
    runner: MainImageLiveExecutorRunResult | null | undefined
): Array<{ path: string; source: string }> {
    const operationResults = runner?.operationResults || [];
    const exportOperations = operationResults.filter((operation) => operationToolName(operation) === 'exportgroup');
    const successfulExportOperations = exportOperations.filter((operation) => operation.success === true);
    const pathEntries: Array<{ path: string; source: string }> = [];

    for (const operation of successfulExportOperations) {
        collectPathValues(operation.actualResult, `${operation.tool}.actualResult`, pathEntries);
        for (const readback of operation.readbackResults || []) {
            if (readback.success === true) {
                collectPathValues(readback.data, readbackSource(readback, `${operation.tool}.readback`), pathEntries);
            }
        }
    }

    if (runner?.finalAcceptanceSnapshot?.success === true) {
        collectPathValues(runner.finalAcceptanceSnapshot.data, 'finalAcceptanceSnapshot.data', pathEntries);
    }

    return pathEntries;
}

export function extractMainImageControlledProductResultPaths(
    runner: MainImageLiveExecutorRunResult | null | undefined
): string[] {
    return Array.from(new Set(extractPathEntries(runner).map((entry) => String(entry.path || '').trim()).filter(Boolean)));
}

function buildResultImageSummary(
    runner: MainImageLiveExecutorRunResult | null | undefined
): MainImageControlledProductResultImageSummary {
    const operationResults = runner?.operationResults || [];
    const exportOperations = operationResults.filter((operation) => operationToolName(operation) === 'exportgroup');
    const successfulExportOperations = exportOperations.filter((operation) => operation.success === true);
    const pathEntries = extractPathEntries(runner);

    const resultImageNames = uniqueStrings(pathEntries.map((entry) => basename(entry.path))).slice(0, 16);
    const sources = uniqueStrings(pathEntries.map((entry) => entry.source)).slice(0, 16);
    const successfulExportWithoutPathCount = successfulExportOperations.filter((operation) => {
        const paths: Array<{ path: string; source: string }> = [];
        collectPathValues(operation.actualResult, `${operation.tool}.actualResult`, paths);
        for (const readback of operation.readbackResults || []) {
            if (readback.success === true) {
                collectPathValues(readback.data, readbackSource(readback, `${operation.tool}.readback`), paths);
            }
        }
        return paths.length === 0;
    }).length;

    return {
        plannedExportCount: exportOperations.length,
        successfulExportCount: successfulExportOperations.length,
        resultImageCount: resultImageNames.length,
        resultImageNames,
        missingOutputPathCount: successfulExportWithoutPathCount,
        sources,
        finalSnapshotCaptured: runner?.finalAcceptanceSnapshot?.success === true
    };
}

function buildResultFileProbeSummary(input: {
    resultImageSummary: MainImageControlledProductResultImageSummary;
    resultFileProbes?: MainImageResultFileProbe[] | null;
    referenceImagePath?: string | null;
}): MainImageControlledProductResultFileProbeSummary {
    const sanitizedProbes = (input.resultFileProbes || []).map(sanitizeResultFileProbe);
    const okFileProbeCount = sanitizedProbes.filter((probe) => probe.status === 'ok' && probe.rawImagesRedacted === true).length;
    const failedFileProbeCount = sanitizedProbes.filter((probe) => probe.status !== 'ok' || probe.rawImagesRedacted !== true).length;
    const missingFileProbeCount = Math.max(0, input.resultImageSummary.resultImageCount - okFileProbeCount);
    const referenceImageName = basename(input.referenceImagePath);

    return {
        fileProbeCount: sanitizedProbes.length,
        okFileProbeCount,
        failedFileProbeCount,
        missingFileProbeCount,
        resultFileNames: uniqueStrings(sanitizedProbes.map((probe) => probe.path)).slice(0, 16),
        probeTargetMode: referenceImageName ? 'reference-image' : input.resultImageSummary.resultImageCount > 0 ? 'result-file-only' : 'unknown',
        referenceImageName: referenceImageName || undefined,
        rawImagesRedacted: sanitizedProbes.every((probe) => probe.rawImagesRedacted === true)
    };
}

function inferStage(input: {
    runner?: MainImageLiveExecutorRunResult | null;
    resultImageSummary: MainImageControlledProductResultImageSummary;
    resultFileProbeSummary: MainImageControlledProductResultFileProbeSummary;
    pixelProbe?: MainImageScreenshotProbeObservation | null;
    manualReview?: MainImageManualReviewRecord | null;
    blockers: string[];
}): MainImageControlledProductQaGateStage {
    if (!input.runner) return 'needs_runner';
    if (input.runner.status !== 'completed_requires_review') return 'blocked';
    if (input.blockers.length > 0) return 'blocked';
    if (input.resultImageSummary.resultImageCount === 0) return 'needs_result_image';
    if (input.resultFileProbeSummary.fileProbeCount === 0) return 'needs_result_file_probe';
    if (input.resultFileProbeSummary.failedFileProbeCount > 0) return 'blocked';
    if (input.resultFileProbeSummary.missingFileProbeCount > 0) return 'needs_result_file_probe';
    if (!input.pixelProbe && input.resultFileProbeSummary.probeTargetMode !== 'reference-image') return 'needs_probe_target';
    if (!input.pixelProbe || input.pixelProbe.status !== 'ok') return 'needs_pixel_probe';
    if (input.pixelProbe.rawImagesRedacted !== true) return 'blocked';
    if (input.manualReview?.decision === 'rejected') return 'blocked';
    if (input.manualReview?.decision !== 'approved') return 'needs_manual_review';
    return 'passed';
}

function statusForStage(stage: MainImageControlledProductQaGateStage): DesignAgentOsStatus {
    if (stage === 'blocked') return 'failed';
    if (stage === 'passed') return 'passed';
    return 'needs_review';
}

function buildQualityClaim(input: {
    stage: MainImageControlledProductQaGateStage;
    resultImageSummary: MainImageControlledProductResultImageSummary;
    resultFileProbeSummary: MainImageControlledProductResultFileProbeSummary;
    pixelProbe?: MainImageScreenshotProbeObservation | null;
    manualReview?: MainImageManualReviewRecord | null;
    blockers: string[];
}): MainImageControlledProductQualityClaim {
    const blockers = [...input.blockers];
    if (input.stage === 'needs_runner') blockers.push('缺少 live runner 执行结果。');
    if (input.resultImageSummary.resultImageCount === 0) blockers.push('缺少可复核的结果图导出记录。');
    if (input.resultFileProbeSummary.fileProbeCount === 0) blockers.push('缺少结果文件探针记录。');
    if (input.resultFileProbeSummary.failedFileProbeCount > 0) blockers.push('结果文件探针存在失败或未脱敏项。');
    if (input.resultFileProbeSummary.missingFileProbeCount > 0) blockers.push('结果文件探针数量不足。');
    if (!input.pixelProbe && input.resultFileProbeSummary.probeTargetMode !== 'reference-image') blockers.push('缺少参考图或等价 pixel probe 目标。');
    if (!input.pixelProbe || input.pixelProbe.status !== 'ok') blockers.push('缺少 pixel probe=ok 的截图级检查结果。');
    if (input.pixelProbe && input.pixelProbe.rawImagesRedacted !== true) blockers.push('pixel probe 必须保持 rawImagesRedacted=true。');
    if (input.manualReview?.decision !== 'approved') blockers.push('缺少人工 approved 复核结论。');
    blockers.push('controlled product QA gate 不是最终主图 QA 报告，不能单独声明设计质量通过。');

    return {
        allowed: false,
        reason: input.stage === 'passed'
            ? '受控商品执行结果已具备结果图、pixel probe 和人工复核，但仍需由最终主图 QA 报告承接质量声明。'
            : '当前受控商品执行结果不足以声明主图设计质量通过。',
        requiredChecks: [
            'runner.status=completed_requires_review',
            'exportGroup 返回可复核结果图路径',
            'resultFileProbe.status=ok',
            'resultFileProbe.rawImagesRedacted=true',
            'finalAcceptanceSnapshot.success=true',
            'pixelProbe.status=ok',
            'pixelProbe.rawImagesRedacted=true',
            'manualReview.decision=approved',
            'final mainImageQaReport.stage=passed'
        ],
        blockers: uniqueStrings(blockers),
        boundary: '该 gate 只汇总受控 product-disposable-live 执行后的检查缺口；最终质量声明必须由截图 QA、pixel probe、人工复核和 mainImageQaReport 共同决定。'
    };
}

function buildChecks(input: {
    runner?: MainImageLiveExecutorRunResult | null;
    stage: MainImageControlledProductQaGateStage;
    resultImageSummary: MainImageControlledProductResultImageSummary;
    resultFileProbeSummary: MainImageControlledProductResultFileProbeSummary;
    pixelProbe?: MainImageScreenshotProbeObservation | null;
    manualReview?: MainImageManualReviewRecord | null;
}): VerificationCheck[] {
    const runnerStatus = cleanString(input.runner?.status) || 'missing';
    const hasResultImage = input.resultImageSummary.resultImageCount > 0;
    const pixelStatus = cleanString(input.pixelProbe?.status) || 'none';
    const manualDecision = cleanString(input.manualReview?.decision) || 'none';

    return [
        {
            id: 'controlled-product-runner',
            label: '受控商品 runner',
            status: input.runner?.status === 'completed_requires_review'
                ? 'passed'
                : input.runner
                    ? 'failed'
                    : 'not_run',
            summary: `runner=${runnerStatus}; executed=${input.runner?.executedOperationCount || 0}; failedOperations=${input.runner?.failedOperationCount || 0}; failedReadback=${input.runner?.failedReadbackCount || 0}`
        },
        {
            id: 'controlled-product-result-image',
            label: '结果图导出记录',
            status: hasResultImage ? 'needs_review' : 'not_run',
            summary: hasResultImage
                ? `发现 ${input.resultImageSummary.resultImageCount} 个结果图文件名记录。`
                : '尚未发现 exportGroup/readback/final snapshot 中的结果图路径。'
        },
        {
            id: 'controlled-product-result-file-probe',
            label: '结果文件探针',
            status: input.resultFileProbeSummary.failedFileProbeCount > 0
                ? 'failed'
                : input.resultFileProbeSummary.missingFileProbeCount === 0 && input.resultFileProbeSummary.okFileProbeCount > 0
                    ? 'passed'
                    : input.resultImageSummary.resultImageCount > 0
                        ? 'needs_review'
                        : 'not_run',
            summary: `fileProbes=${input.resultFileProbeSummary.fileProbeCount}; ok=${input.resultFileProbeSummary.okFileProbeCount}; failed=${input.resultFileProbeSummary.failedFileProbeCount}; missing=${input.resultFileProbeSummary.missingFileProbeCount}`
        },
        {
            id: 'controlled-product-probe-target',
            label: '像素探针目标',
            status: input.resultFileProbeSummary.probeTargetMode === 'reference-image'
                ? 'needs_review'
                : input.pixelProbe
                    ? 'needs_review'
                    : 'not_run',
            summary: input.resultFileProbeSummary.probeTargetMode === 'reference-image'
                ? `reference=${input.resultFileProbeSummary.referenceImageName || 'provided'}`
                : '没有参考图或等价 pixel probe 目标。'
        },
        {
            id: 'controlled-product-pixel-probe',
            label: '截图像素探针',
            status: input.pixelProbe?.status === 'ok'
                ? 'passed'
                : input.pixelProbe?.status === 'watch'
                    ? 'needs_review'
                    : 'not_run',
            summary: input.pixelProbe
                ? `pixelProbe=${pixelStatus}; rawImagesRedacted=${input.pixelProbe.rawImagesRedacted === true}`
                : '没有 pixel probe 检查结果。'
        },
        {
            id: 'controlled-product-manual-review',
            label: '人工复核',
            status: input.manualReview?.decision === 'approved'
                ? 'passed'
                : input.manualReview?.decision === 'rejected'
                    ? 'failed'
                    : 'not_run',
            summary: `manualReview=${manualDecision}; score=${input.manualReview?.score ?? 'unknown'}`
        },
        {
            id: 'controlled-product-quality-boundary',
            label: '质量声明边界',
            status: input.stage === 'passed' ? 'needs_review' : statusForStage(input.stage),
            summary: 'controlled product QA gate 不单独声明设计质量通过。'
        },
        {
            id: 'controlled-product-redaction',
            label: '结果脱敏',
            status: 'passed',
            summary: '报告仅暴露结果图文件名和汇总计数，不透传原始图像 payload 或绝对路径。'
        }
    ];
}

function buildNextActions(stage: MainImageControlledProductQaGateStage): string[] {
    if (stage === 'needs_runner') {
        return ['先完成 product-disposable-live runner 执行，保留 operationResults 和 finalAcceptanceSnapshot。'];
    }
    if (stage === 'blocked') {
        return ['先修复 runner/导出/读回阻断项，再重新生成受控商品 QA gate。'];
    }
    if (stage === 'needs_result_image') {
        return ['检查 exportGroup 是否返回 outputPath/filePath/resultPath，并确认导出文件可被后续截图 QA 读取。'];
    }
    if (stage === 'needs_result_file_probe') {
        return ['对 exportGroup 结果路径运行文件探针，确认结果图存在、可解码且 rawImagesRedacted=true。'];
    }
    if (stage === 'needs_probe_target') {
        return ['提供 referenceImagePath 或等价 pixel probe 目标，避免仅凭结果文件存在就进入质量判断。'];
    }
    if (stage === 'needs_pixel_probe') {
        return ['对结果图运行 pixel probe 或等价截图对比，并确保 rawImagesRedacted=true。'];
    }
    if (stage === 'needs_manual_review') {
        return ['基于结果图和 pixel probe 检查结果完成人工复核，记录 approved/needs_review/rejected。'];
    }
    return ['把该 gate 交给最终 mainImageQaReport 合并，并纳入最终质量边界。'];
}

export function buildMainImageControlledProductQaGate(
    input: MainImageControlledProductQaGateInput
): MainImageControlledProductQaGate {
    const runner = input.runner || null;
    const pixelProbe = sanitizePixelProbe(input.pixelProbe);
    const manualReview = sanitizeManualReview(input.manualReview);
    const resultImageSummary = buildResultImageSummary(runner);
    const resultFileProbeSummary = buildResultFileProbeSummary({
        resultImageSummary,
        resultFileProbes: input.resultFileProbes,
        referenceImagePath: input.referenceImagePath
    });
    const runnerBlockers = cleanBlockers(runner?.blockers || []);
    const runnerWarnings = cleanBlockers(runner?.warnings || []);
    const blockers = [...runnerBlockers];
    const warnings = [...runnerWarnings];

    if (runner?.status === 'completed_requires_review' && !resultImageSummary.finalSnapshotCaptured) {
        warnings.push('runner 已完成但缺少 finalAcceptanceSnapshot 成功结果。');
    }
    if (resultImageSummary.successfulExportCount > 0 && resultImageSummary.missingOutputPathCount > 0) {
        warnings.push('存在成功的 exportGroup 操作，但没有返回可复核输出路径。');
    }
    if (resultFileProbeSummary.failedFileProbeCount > 0) {
        blockers.push('结果文件探针存在失败或未脱敏项。');
    }
    if (pixelProbe && pixelProbe.rawImagesRedacted !== true) {
        blockers.push('pixel probe 未保持 rawImagesRedacted=true。');
    }
    if (manualReview?.decision === 'rejected') {
        blockers.push('人工复核拒绝当前主图结果。');
    }

    const stage = inferStage({
        runner,
        resultImageSummary,
        resultFileProbeSummary,
        pixelProbe,
        manualReview,
        blockers: uniqueStrings(blockers)
    });
    const status = statusForStage(stage);
    const finalBlockers = uniqueStrings(blockers);
    const finalWarnings = uniqueStrings(warnings);
    const qualityClaim = buildQualityClaim({
        stage,
        resultImageSummary,
        resultFileProbeSummary,
        pixelProbe,
        manualReview,
        blockers: finalBlockers
    });
    const checks = buildChecks({
        runner,
        stage,
        resultImageSummary,
        resultFileProbeSummary,
        pixelProbe,
        manualReview
    });
    const limitations = [
        '该 gate 只汇总 product-disposable-live 受控执行后的检查缺口，不直接评价审美质量。',
        '报告不会透传 runner.actualResult、readback.data 或 finalAcceptanceSnapshot.data 的原始对象。',
        '结果图路径只保留文件名，绝对路径必须留在本地执行上下文中。',
        '结果文件探针只保留文件名、计数、尺寸和 hash 摘要，不返回 raw image 或 base64。',
        '没有最终 mainImageQaReport 通过时，不能声明主图设计质量通过。'
    ];
    const summary = stage === 'passed'
        ? '受控商品执行 QA gate 已具备结果图、pixel probe 和人工复核结果，但仍需最终 QA 报告承接质量声明。'
        : `受控商品执行 QA gate 处于 ${stage}，仍不能声明主图设计质量通过。`;
    const verificationReport: VerificationReport = {
        reportId: 'main-image-controlled-product-qa-gate',
        scenario: 'main-image',
        status,
        scope: 'task',
        summary,
        checks,
        blockers: finalBlockers,
        warnings: finalWarnings,
        limitations
    };

    return {
        gateVersion: 'main-image-controlled-product-qa-gate/v0',
        scenario: 'main-image',
        status,
        stage,
        summary,
        runnerStatus: cleanString(runner?.status) || 'missing',
        executedOperationCount: runner?.executedOperationCount || 0,
        failedOperationCount: runner?.failedOperationCount || 0,
        failedReadbackCount: runner?.failedReadbackCount || 0,
        resultImageSummary,
        resultFileProbeSummary,
        pixelProbe,
        manualReview,
        qualityClaim,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        requiresManualReviewBeforeQualityClaim: true,
        checks,
        blockers: finalBlockers,
        warnings: finalWarnings,
        limitations,
        nextActions: buildNextActions(stage),
        redaction: {
            rawImagesRedacted: true,
            pathsRedacted: true,
            pathPolicy: 'Only basename resultImageNames are exposed; absolute paths and raw image payloads stay out of the gate report.'
        },
        verificationReport
    };
}
