import type {
    DesignAgentOsStatus,
    MainImageSizePlan,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type { MainImageLiveExecutorRunResult } from './main-image-live-executor-runner';
import {
    buildMainImageControlledProductQaGate,
    extractMainImageControlledProductResultPaths,
    type MainImageControlledProductQaGate,
    type MainImageControlledProductQualityClaim,
    type MainImageControlledProductResultFileProbeSummary,
    type MainImageControlledProductResultImageSummary
} from './main-image-controlled-product-qa-gate';
import {
    buildMainImageScreenshotQa,
    type MainImageScreenshotProbeObservation,
    type MainImageScreenshotQa,
    type MainImageScreenshotQaStage
} from './main-image-screenshot-qa';
import {
    buildMainImageScreenshotProbeReadiness,
    type MainImageResultFileProbe,
    type MainImageScreenshotProbeReadiness,
    type MainImageScreenshotProbeReadinessStage
} from './main-image-screenshot-probe-readiness';
import type { MainImageManualReviewRecord } from './main-image-visual-loop';

export type MainImageControlledProductQaBridgeStage =
    | 'needs_runner'
    | 'needs_result_image'
    | 'needs_result_file_probe'
    | 'needs_probe_target'
    | 'needs_pixel_probe'
    | 'needs_manual_review'
    | 'passed'
    | 'blocked';

export interface MainImageControlledProductQaBridgeRedaction {
    rawImagesRedacted: true;
    pathsRedacted: true;
    pathPolicy: string;
}

export interface MainImageControlledProductQaBridge {
    bridgeVersion: 'main-image-controlled-product-qa-bridge/v0';
    scenario: 'main-image';
    status: DesignAgentOsStatus;
    stage: MainImageControlledProductQaBridgeStage;
    summary: string;
    gateStage: MainImageControlledProductQaGate['stage'];
    screenshotQaStage: MainImageScreenshotQaStage;
    screenshotProbeReadinessStage: MainImageScreenshotProbeReadinessStage;
    resultImageSummary: MainImageControlledProductResultImageSummary;
    resultFileProbeSummary: MainImageControlledProductResultFileProbeSummary;
    qualityClaim: MainImageControlledProductQualityClaim;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    requiresManualReviewBeforeQualityClaim: true;
    checks: VerificationCheck[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    nextActions: string[];
    redaction: MainImageControlledProductQaBridgeRedaction;
    verificationReport: VerificationReport;
}

export interface MainImageControlledProductQaBundle {
    bundleVersion: 'main-image-controlled-product-qa-bundle/v0';
    screenshotQa: MainImageScreenshotQa;
    screenshotProbeReadiness: MainImageScreenshotProbeReadiness;
    bridge: MainImageControlledProductQaBridge;
}

export interface MainImageControlledProductQaBridgeInput {
    runner?: MainImageLiveExecutorRunResult | null;
    sizePlans?: MainImageSizePlan[];
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
const WINDOWS_ABSOLUTE_PATH_PATTERN = /[A-Za-z]:[\\/][^\s"'<>|]+/g;

function basename(value: unknown): string {
    const text = String(value || '').trim().replace(/\\/g, '/');
    if (!text) return '';
    return text.split('/').filter(Boolean).pop() || text;
}

function redactPathsInText(value: string): string {
    return value.replace(WINDOWS_ABSOLUTE_PATH_PATTERN, (match) => basename(match) || '[redacted-path]');
}

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        pattern.lastIndex = 0;
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return redactPathsInText(text).replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function statusForStage(stage: MainImageControlledProductQaBridgeStage): DesignAgentOsStatus {
    if (stage === 'passed') return 'passed';
    if (stage === 'blocked') return 'failed';
    return 'needs_review';
}

function inferBridgeStage(input: {
    gate: MainImageControlledProductQaGate;
    screenshotQa: MainImageScreenshotQa;
    screenshotProbeReadiness: MainImageScreenshotProbeReadiness;
}): MainImageControlledProductQaBridgeStage {
    if (input.gate.stage === 'needs_runner') return 'needs_runner';
    if (
        input.gate.stage === 'blocked'
        || input.screenshotQa.stage === 'blocked'
        || input.screenshotProbeReadiness.stage === 'blocked'
    ) {
        return 'blocked';
    }
    if (input.screenshotProbeReadiness.stage === 'needs_result_image') return 'needs_result_image';
    if (input.screenshotProbeReadiness.stage === 'needs_result_file_probe') return 'needs_result_file_probe';
    if (input.screenshotProbeReadiness.stage === 'needs_probe_target') return 'needs_probe_target';
    if (input.screenshotProbeReadiness.stage === 'ready_for_pixel_probe') return 'needs_pixel_probe';
    if (input.screenshotProbeReadiness.stage === 'needs_manual_review') return 'needs_manual_review';
    if (input.screenshotProbeReadiness.stage === 'passed' && input.screenshotQa.stage === 'passed') return 'passed';
    if (input.screenshotQa.stage === 'needs_manual_review') return 'needs_manual_review';
    if (input.screenshotQa.stage === 'needs_pixel_probe') return 'needs_pixel_probe';
    return 'needs_result_image';
}

function buildNextActions(stage: MainImageControlledProductQaBridgeStage): string[] {
    if (stage === 'needs_runner') {
        return ['先完成 product-disposable-live runner 执行，再把 runner 结果接入截图 QA。'];
    }
    if (stage === 'blocked') {
        return ['先修复 runner、结果文件探针或截图 QA 阻断项，再重新生成 bridge。'];
    }
    if (stage === 'needs_result_image') {
        return ['确认 exportGroup/readback/final snapshot 能提供可复核结果图路径。'];
    }
    if (stage === 'needs_result_file_probe') {
        return ['对 runner 提取到的结果图路径运行文件探针，确认文件存在、可解码且脱敏。'];
    }
    if (stage === 'needs_probe_target') {
        return ['提供 referenceImagePath 或等价 pixel probe 目标，避免仅凭结果文件存在进入质量判断。'];
    }
    if (stage === 'needs_pixel_probe') {
        return ['运行 pixel probe 或等价截图对比，并确保 rawImagesRedacted=true。'];
    }
    if (stage === 'needs_manual_review') {
        return ['基于结果图和 pixel probe 完成人工复核，并记录 approved/needs_review/rejected。'];
    }
    return ['把 screenshot QA 和 readiness 交给最终 mainImageQaReport；bridge 本身不声明设计质量通过。'];
}

function buildQualityClaim(stage: MainImageControlledProductQaBridgeStage, gate: MainImageControlledProductQaGate): MainImageControlledProductQualityClaim {
    return {
        ...gate.qualityClaim,
        allowed: false,
        reason: stage === 'passed'
            ? 'controlled product 结果已进入截图 QA/readiness 并通过，但 bridge 仍不能替代最终 mainImageQaReport。'
            : 'controlled product 结果尚未满足截图 QA/readiness 完整闭环，不能声明主图设计质量通过。',
        boundary: 'bridge 只把 product-disposable-live 结果接入现有 screenshot QA 和 probe readiness；最终质量声明必须由 mainImageQaReport 根据真实检查结果决定。',
        blockers: uniqueStrings([
            ...gate.qualityClaim.blockers,
            'mainImageControlledProductQaBridge 不是最终主图 QA 报告。'
        ])
    };
}

function buildChecks(input: {
    stage: MainImageControlledProductQaBridgeStage;
    gate: MainImageControlledProductQaGate;
    screenshotQa: MainImageScreenshotQa;
    screenshotProbeReadiness: MainImageScreenshotProbeReadiness;
}): VerificationCheck[] {
    return [
        {
            id: 'controlled-product-qa-gate-stage',
            label: '受控商品 gate',
            status: input.gate.stage === 'blocked'
                ? 'failed'
                : input.gate.stage === 'passed'
                    ? 'passed'
                    : 'needs_review',
            summary: `gate=${input.gate.stage}; runner=${input.gate.runnerStatus}; resultImages=${input.gate.resultImageSummary.resultImageCount}`
        },
        {
            id: 'controlled-product-screenshot-qa-stage',
            label: '截图 QA 接入',
            status: input.screenshotQa.stage === 'blocked'
                ? 'failed'
                : input.screenshotQa.stage === 'passed'
                    ? 'passed'
                    : 'needs_review',
            summary: `mainImageScreenshotQa=${input.screenshotQa.stage}; resultImages=${input.screenshotQa.resultImageRecord.resultPaths.length}; pixelProbe=${input.screenshotQa.pixelProbe?.status || 'none'}`
        },
        {
            id: 'controlled-product-probe-readiness-stage',
            label: '截图探针 readiness 接入',
            status: input.screenshotProbeReadiness.stage === 'blocked'
                ? 'failed'
                : input.screenshotProbeReadiness.stage === 'passed'
                    ? 'passed'
                    : 'needs_review',
            summary: `mainImageScreenshotProbeReadiness=${input.screenshotProbeReadiness.stage}; fileProbes=${input.screenshotProbeReadiness.resultFileProbes.length}`
        },
        {
            id: 'controlled-product-bridge-redaction',
            label: 'bridge 脱敏',
            status: 'passed',
            summary: 'bridge 摘要只暴露文件名、计数和阶段，不透传 raw/base64 payload 或绝对路径。'
        },
        {
            id: 'controlled-product-bridge-quality-boundary',
            label: '质量声明边界',
            status: input.stage === 'passed' ? 'needs_review' : statusForStage(input.stage),
            summary: 'bridge 不生成也不伪造 mainImageQaReport，qualityClaim.allowed 固定为 false。'
        }
    ];
}

function buildBridge(input: {
    gate: MainImageControlledProductQaGate;
    screenshotQa: MainImageScreenshotQa;
    screenshotProbeReadiness: MainImageScreenshotProbeReadiness;
}): MainImageControlledProductQaBridge {
    const stage = inferBridgeStage(input);
    const status = statusForStage(stage);
    const checks = buildChecks({ stage, ...input });
    const blockers = uniqueStrings([
        ...input.gate.blockers,
        ...input.screenshotQa.blockers,
        ...input.screenshotProbeReadiness.blockers
    ]);
    const warnings = uniqueStrings([
        ...input.gate.warnings,
        ...input.screenshotQa.warnings,
        ...input.screenshotProbeReadiness.warnings
    ]);
    const limitations = [
        'bridge 只做 product-disposable-live 到现有截图 QA/readiness 的结果映射，不执行 Photoshop 写操作。',
        'bridge 摘要会脱敏路径和原始图片 payload；canonical screenshot QA/readiness 对象仍按内部结果契约保留路径。',
        'bridge 不生成 mainImageQaReport，也不伪造 agentDraft、candidate 或 vision 上下文。',
        'bridge 通过只代表截图 QA/readiness 检查闭环，不代表最终设计质量声明。'
    ];
    const qualityClaim = buildQualityClaim(stage, input.gate);
    const verificationReport: VerificationReport = {
        reportId: 'main-image-controlled-product-qa-bridge',
        scenario: 'main-image',
        status,
        scope: 'screenshot',
        summary: stage === 'passed'
            ? '受控商品执行结果已接入现有截图 QA/readiness，仍等待最终 mainImageQaReport 承接质量声明。'
            : `受控商品执行结果接入截图 QA/readiness 的阶段为 ${stage}。`,
        checks,
        blockers,
        warnings,
        limitations
    };

    return {
        bridgeVersion: 'main-image-controlled-product-qa-bridge/v0',
        scenario: 'main-image',
        status,
        stage,
        summary: verificationReport.summary,
        gateStage: input.gate.stage,
        screenshotQaStage: input.screenshotQa.stage,
        screenshotProbeReadinessStage: input.screenshotProbeReadiness.stage,
        resultImageSummary: input.gate.resultImageSummary,
        resultFileProbeSummary: input.gate.resultFileProbeSummary,
        qualityClaim,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        requiresManualReviewBeforeQualityClaim: true,
        checks,
        blockers,
        warnings,
        limitations,
        nextActions: buildNextActions(stage),
        redaction: {
            rawImagesRedacted: true,
            pathsRedacted: true,
            pathPolicy: 'bridge 摘要只保留 basename 和计数；canonical screenshot QA/readiness 对象保持现有内部结果路径契约。'
        },
        verificationReport
    };
}

export function buildMainImageControlledProductQaBundle(
    input: MainImageControlledProductQaBridgeInput
): MainImageControlledProductQaBundle {
    const gate = buildMainImageControlledProductQaGate(input);
    const resultPaths = extractMainImageControlledProductResultPaths(input.runner);
    const screenshotQa = buildMainImageScreenshotQa({
        sizePlans: input.sizePlans,
        resultImageRecord: {
            plannedExportCount: gate.resultImageSummary.plannedExportCount,
            successfulExportCount: gate.resultImageSummary.successfulExportCount,
            resultPaths,
            missingOutputPathCount: gate.resultImageSummary.missingOutputPathCount,
            sources: gate.resultImageSummary.sources.map((source) => `controlledProduct.${source}`)
        },
        pixelProbe: gate.pixelProbe,
        manualReview: gate.manualReview
    });
    const screenshotProbeReadiness = buildMainImageScreenshotProbeReadiness({
        screenshotQa,
        sizePlans: input.sizePlans,
        fileProbes: input.resultFileProbes || [],
        referenceImagePath: input.referenceImagePath
    });
    const bridge = buildBridge({
        gate,
        screenshotQa,
        screenshotProbeReadiness
    });

    return {
        bundleVersion: 'main-image-controlled-product-qa-bundle/v0',
        screenshotQa,
        screenshotProbeReadiness,
        bridge
    };
}

export function buildMainImageControlledProductQaBridge(
    input: MainImageControlledProductQaBridgeInput
): MainImageControlledProductQaBridge {
    return buildMainImageControlledProductQaBundle(input).bridge;
}
