import type {
    DesignAgentOsStatus,
    MainImageSizePlan,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type {
    MainImageScreenshotProbeObservation,
    MainImageScreenshotQa
} from './main-image-screenshot-qa';

export type MainImageResultFileProbeStatus =
    | 'ok'
    | 'missing'
    | 'not_file'
    | 'unsupported'
    | 'decode_failed'
    | 'unavailable';

export interface MainImageResultFileProbe {
    path: string;
    status: MainImageResultFileProbeStatus;
    exists?: boolean;
    isFile?: boolean;
    byteLength?: number;
    format?: string;
    dimensions?: { width: number; height: number };
    sha256?: string;
    error?: string;
    rawImagesRedacted: boolean;
}

export type MainImageScreenshotProbeReadinessStage =
    | 'needs_result_image'
    | 'needs_result_file_probe'
    | 'needs_probe_target'
    | 'ready_for_pixel_probe'
    | 'needs_manual_review'
    | 'passed'
    | 'blocked';

export interface MainImageScreenshotProbeTarget {
    mode: 'reference-image' | 'result-file-only' | 'unknown';
    referenceImagePath?: string;
    targetSize?: { width: number; height: number };
    status: DesignAgentOsStatus;
    notes: string[];
}

export interface MainImageScreenshotProbeReadiness {
    readinessVersion: 'main-image-screenshot-probe-readiness/v0';
    scenario: 'main-image';
    status: DesignAgentOsStatus;
    stage: MainImageScreenshotProbeReadinessStage;
    resultFileProbes: MainImageResultFileProbe[];
    probeTarget: MainImageScreenshotProbeTarget;
    pixelProbe?: MainImageScreenshotProbeObservation;
    checks: VerificationCheck[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    verificationReport: VerificationReport;
}

export interface MainImageScreenshotProbeReadinessInput {
    screenshotQa: MainImageScreenshotQa;
    sizePlans?: MainImageSizePlan[];
    fileProbes?: MainImageResultFileProbe[];
    referenceImagePath?: string | null;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/');
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(normalizePath).filter(Boolean)));
}

function statusFromReadinessStage(stage: MainImageScreenshotProbeReadinessStage): DesignAgentOsStatus {
    if (stage === 'passed') return 'passed';
    if (stage === 'blocked') return 'failed';
    return 'needs_review';
}

function resultFileProbeCheckStatus(
    allExpectedProbed: boolean,
    expectedResultPathCount: number
): VerificationCheck['status'] {
    if (allExpectedProbed) return 'passed';
    if (expectedResultPathCount > 0) return 'needs_review';
    return 'not_run';
}

function resultFileProbeCheckSummary(input: {
    allExpectedProbed: boolean;
    okFileProbeCount: number;
    expectedResultPathCount: number;
    fileProbeCount: number;
}): string {
    if (input.allExpectedProbed) {
        return `已验证 ${input.okFileProbeCount} 个结果图文件存在且可解码。`;
    }

    if (input.expectedResultPathCount > 0) {
        return `结果图路径 ${input.expectedResultPathCount} 个，已探针 ${input.fileProbeCount} 个。`;
    }

    return '没有结果图路径。';
}

function targetSizeForPath(path: string, sizePlans: MainImageSizePlan[]): { width: number; height: number } | undefined {
    const normalized = normalizePath(path);
    const exact = sizePlans.find((plan) => normalizePath(plan.quickExportOutputPath) === normalized);
    const fallback = exact || sizePlans.find((plan) => plan.targetSize?.width > 0 && plan.targetSize?.height > 0);
    return fallback?.targetSize;
}

function dimensionsMatch(
    probe: MainImageResultFileProbe,
    sizePlans: MainImageSizePlan[]
): boolean | undefined {
    const expected = targetSizeForPath(probe.path, sizePlans);
    if (!expected || !probe.dimensions) return undefined;
    return probe.dimensions.width === expected.width && probe.dimensions.height === expected.height;
}

function buildProbeTarget(input: MainImageScreenshotProbeReadinessInput): MainImageScreenshotProbeTarget {
    const referenceImagePath = normalizePath(input.referenceImagePath);
    const targetSize = input.sizePlans?.find((plan) => plan.targetSize?.width > 0 && plan.targetSize?.height > 0)?.targetSize;
    if (referenceImagePath) {
        return {
            mode: 'reference-image',
            referenceImagePath,
            targetSize,
            status: 'needs_review',
            notes: ['存在参考图路径，可以作为后续像素探针目标，但仍需运行真实探针。']
        };
    }
    return {
        mode: 'result-file-only',
        targetSize,
        status: 'needs_review',
        notes: [
            '当前只有结果图文件记录，没有参考图或明确像素探针目标。',
            '结果文件可解码只能证明导出存在，不能替代截图相似度或审美验收。'
        ]
    };
}

export function buildMainImageScreenshotProbeReadiness(
    input: MainImageScreenshotProbeReadinessInput
): MainImageScreenshotProbeReadiness {
    const screenshotQa = input.screenshotQa;
    const sizePlans = input.sizePlans || [];
    const expectedResultPaths = uniqueStrings(screenshotQa.resultImageRecord.resultPaths || []);
    const fileProbes = Array.isArray(input.fileProbes)
        ? input.fileProbes.map((probe) => ({
            ...probe,
            path: normalizePath(probe.path),
            rawImagesRedacted: probe.rawImagesRedacted === true
        }))
        : [];
    const probeTarget = buildProbeTarget(input);
    const blockers: string[] = [];
    const warnings: string[] = [];
    const pixelProbe = screenshotQa.pixelProbe;

    if (expectedResultPaths.length === 0) {
        warnings.push('没有结果图路径，无法准备截图像素探针。');
    }

    const probedPaths = new Set(fileProbes.map((probe) => normalizePath(probe.path)));
    const missingProbePaths = expectedResultPaths.filter((path) => !probedPaths.has(path));
    if (expectedResultPaths.length > 0 && missingProbePaths.length > 0) {
        warnings.push(`存在 ${missingProbePaths.length} 个结果图路径尚未做文件探针。`);
    }

    for (const probe of fileProbes) {
        if (probe.rawImagesRedacted !== true) {
            blockers.push(`结果图文件探针必须保持 rawImagesRedacted=true: ${probe.path}`);
        }
        if (probe.status !== 'ok') {
            blockers.push(`结果图文件不可用于截图探针: ${probe.path} (${probe.status}${probe.error ? `: ${probe.error}` : ''})`);
        }
        const match = dimensionsMatch(probe, sizePlans);
        if (match === false) {
            warnings.push(`结果图尺寸与计划尺寸不一致: ${probe.path} (${probe.dimensions?.width || 0}x${probe.dimensions?.height || 0})。`);
        }
    }

    const okFileProbeCount = fileProbes.filter((probe) => probe.status === 'ok' && probe.rawImagesRedacted === true).length;
    const allExpectedProbed = expectedResultPaths.length > 0
        && missingProbePaths.length === 0
        && okFileProbeCount >= expectedResultPaths.length;

    let stage: MainImageScreenshotProbeReadinessStage = 'needs_result_image';
    if (blockers.length > 0 || screenshotQa.stage === 'blocked') stage = 'blocked';
    else if (screenshotQa.stage === 'passed') stage = 'passed';
    else if (expectedResultPaths.length === 0) stage = 'needs_result_image';
    else if (!allExpectedProbed) stage = 'needs_result_file_probe';
    else if (!pixelProbe && probeTarget.mode !== 'reference-image') stage = 'needs_probe_target';
    else if (!pixelProbe) stage = 'ready_for_pixel_probe';
    else if (pixelProbe.status === 'ok' && screenshotQa.stage === 'needs_manual_review') stage = 'needs_manual_review';
    else if (pixelProbe.status !== 'ok') stage = 'ready_for_pixel_probe';

    const status = statusFromReadinessStage(stage);

    const checks: VerificationCheck[] = [
        {
            id: 'main-image-result-file-probe',
            label: '结果图文件探针',
            status: resultFileProbeCheckStatus(allExpectedProbed, expectedResultPaths.length),
            summary: resultFileProbeCheckSummary({
                allExpectedProbed,
                okFileProbeCount,
                expectedResultPathCount: expectedResultPaths.length,
                fileProbeCount: fileProbes.length
            })
        },
        {
            id: 'main-image-probe-target',
            label: '像素探针目标',
            status: probeTarget.mode === 'reference-image' ? 'needs_review' : 'not_run',
            summary: probeTarget.mode === 'reference-image'
                ? `参考图路径: ${probeTarget.referenceImagePath}`
                : '没有参考图或明确像素探针目标。'
        },
        {
            id: 'main-image-pixel-probe-result',
            label: '像素探针结果',
            status: pixelProbe?.status === 'ok'
                ? 'passed'
                : pixelProbe?.status === 'watch'
                    ? 'needs_review'
                    : 'not_run',
            summary: pixelProbe
                ? `${pixelProbe.mode}=${pixelProbe.status}; ${pixelProbe.summary || pixelProbe.boundary || '无摘要'}`
                : '尚未生成 pixel probe 结果。'
        },
        {
            id: 'main-image-probe-no-quality-claim',
            label: '质量声明边界',
            status: stage === 'passed' ? 'passed' : 'needs_review',
            summary: stage === 'passed'
                ? '只有 screenshot QA 已通过时才允许通过。'
                : 'readiness 只证明探针准备状态，不能声明主图设计质量通过。'
        }
    ];

    if (stage === 'needs_probe_target') {
        warnings.push('结果图文件可用，但缺少参考图或明确像素探针目标。');
    }
    if (stage === 'ready_for_pixel_probe') {
        warnings.push('像素探针输入已准备，但尚未生成可用于复核的 pixel probe 结果。');
    }

    const limitations = [
        'screenshotProbeReadiness 只判断结果图文件、探针目标和脱敏边界是否齐全，不执行 Photoshop，也不改写设计结果。',
        '文件存在和尺寸正确不能证明构图、文案、审美或平台合规通过。',
        '没有 pixelProbe=ok 和人工 approved 时，不能把主图结果标记为设计质量通过。',
        '所有文件探针只返回路径、尺寸、大小、hash 和指标摘要，不返回 raw image 或 base64。'
    ];
    const verificationReport: VerificationReport = {
        reportId: 'main-image-screenshot-probe-readiness',
        scenario: 'main-image',
        status,
        scope: 'screenshot',
        summary: `主图截图探针准备阶段为 ${stage}。`,
        checks,
        blockers,
        warnings,
        limitations
    };

    return {
        readinessVersion: 'main-image-screenshot-probe-readiness/v0',
        scenario: 'main-image',
        status,
        stage,
        resultFileProbes: fileProbes,
        probeTarget,
        pixelProbe,
        checks,
        blockers,
        warnings,
        limitations,
        verificationReport
    };
}
