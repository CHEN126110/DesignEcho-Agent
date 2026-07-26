import type {
    DesignAgentOsStatus,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type { MainImageControlledProductQaBridge } from './main-image-controlled-product-qa-bridge';
import type { MainImageQaReport } from './main-image-qa-report';
import type { MainImageResultFileProbe } from './main-image-screenshot-probe-readiness';
import type { MainImageManualReviewRecord } from './main-image-visual-loop';

export type MainImageAcceptanceRecordStage =
    | 'needs_qa_report'
    | 'needs_quality_checks'
    | 'needs_manual_review'
    | 'needs_acceptance_review'
    | 'blocked_invalid_review'
    | 'rejected'
    | 'recorded'
    | 'blocked';

export interface MainImageAcceptanceRecordSourceSummary {
    source: string;
    caseId: string;
    qaReportVersion: string;
    qaStage: string;
    bridgeVersion: string;
    bridgeStage: string;
    screenshotQaStage: string;
    probeReadinessStage: string;
    resultImageCount: number;
    resultImageNames: string[];
    resultFileProbeCount: number;
    okResultFileProbeCount: number;
    referenceImageName?: string;
}

export interface MainImageAcceptanceRecordManualReview {
    decision: 'approved' | 'needs_review' | 'rejected' | 'none';
    reviewer?: string;
    score?: number;
    notes: string[];
    reviewedAt?: string;
    validationErrors: string[];
}

export interface MainImageAcceptanceRecordReplay {
    deterministic: true;
    requiredInputs: string[];
    suggestedCommand: string;
    notes: string[];
}

export interface MainImageAcceptanceRecordQualityClaim {
    allowed: boolean;
    reason: string;
    requiredChecks: string[];
    blockers: string[];
    boundary: string;
}

export interface MainImageAcceptanceRecordRedaction {
    rawImagesRedacted: true;
    pathsRedacted: true;
    pathPolicy: string;
}

export interface MainImageAcceptanceRecord {
    recordVersion: 'main-image-acceptance-record/v0';
    scenario: 'main-image';
    status: DesignAgentOsStatus;
    stage: MainImageAcceptanceRecordStage;
    summary: string;
    sourceSummary: MainImageAcceptanceRecordSourceSummary;
    manualReview: MainImageAcceptanceRecordManualReview;
    replay: MainImageAcceptanceRecordReplay;
    qualityClaim: MainImageAcceptanceRecordQualityClaim;
    canClaimOutputQuality: boolean;
    canClaimDesignComplete: false;
    checks: VerificationCheck[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    nextActions: string[];
    redaction: MainImageAcceptanceRecordRedaction;
    verificationReport: VerificationReport;
}

export interface MainImageAcceptanceRecordInput {
    caseId?: string | null;
    source?: string | null;
    qaReport?: MainImageQaReport | null;
    controlledProductQaBridge?: MainImageControlledProductQaBridge | null;
    resultFileProbes?: MainImageResultFileProbe[] | null;
    resultImagePaths?: string[] | null;
    referenceImagePath?: string | null;
    manualReview?: MainImageManualReviewRecord | null;
    replayCommand?: string | null;
    recordedAt?: string | null;
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

function uniqueStrings(values: unknown[], limit = 12): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean))).slice(0, limit);
}

function uniqueBasenames(values: unknown[], limit = 16): string[] {
    return Array.from(new Set(values.map(basename).map(cleanString).filter(Boolean))).slice(0, limit);
}

function normalizeDecision(value: unknown): MainImageAcceptanceRecordManualReview['decision'] {
    if (value === 'approved' || value === 'needs_review' || value === 'rejected') return value;
    return 'none';
}

function normalizeScore(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeManualReview(
    value: MainImageManualReviewRecord | null | undefined,
    recordedAt: string
): MainImageAcceptanceRecordManualReview {
    const decision = normalizeDecision(value?.decision);
    const reviewer = cleanString(value?.reviewer) || undefined;
    const score = normalizeScore(value?.score);
    const notes = uniqueStrings(value?.notes || [], 8);
    const reviewedAt = cleanString((value as any)?.reviewedAt) || recordedAt || undefined;
    const validationErrors: string[] = [];

    if (decision === 'none') {
        validationErrors.push('acceptance manualReview.decision is required.');
    }
    if ((decision === 'approved' || decision === 'rejected') && !reviewer) {
        validationErrors.push('acceptance manualReview.reviewer is required for approved/rejected decisions.');
    }
    if (score !== undefined && (score < 0 || score > 1)) {
        validationErrors.push('acceptance manualReview.score must be between 0 and 1.');
    }
    if (decision === 'approved' && score === undefined) {
        validationErrors.push('acceptance manualReview.score is required for approved decisions.');
    }

    return {
        decision,
        reviewer,
        score,
        notes,
        reviewedAt,
        validationErrors
    };
}

function buildSourceSummary(input: MainImageAcceptanceRecordInput): MainImageAcceptanceRecordSourceSummary {
    const qaReport = input.qaReport || null;
    const bridge = input.controlledProductQaBridge || null;
    const fileProbes = input.resultFileProbes || [];
    const resultImageNames = uniqueBasenames([
        ...(qaReport?.resultImageSummary.resultImageNames || []),
        ...(bridge?.resultImageSummary.resultImageNames || []),
        ...(bridge?.resultFileProbeSummary.resultFileNames || []),
        ...(input.resultImagePaths || []),
        ...fileProbes.map((probe) => probe.path)
    ]);
    return {
        source: cleanString(input.source) || 'main-image',
        caseId: cleanString(input.caseId) || 'unassigned-main-image-case',
        qaReportVersion: cleanString(qaReport?.reportVersion) || 'none',
        qaStage: cleanString(qaReport?.stage) || 'none',
        bridgeVersion: cleanString(bridge?.bridgeVersion) || 'none',
        bridgeStage: cleanString(bridge?.stage) || 'none',
        screenshotQaStage: cleanString(bridge?.screenshotQaStage) || 'none',
        probeReadinessStage: cleanString(bridge?.screenshotProbeReadinessStage) || 'none',
        resultImageCount: resultImageNames.length,
        resultImageNames,
        resultFileProbeCount: fileProbes.length || bridge?.resultFileProbeSummary.fileProbeCount || 0,
        okResultFileProbeCount: fileProbes.filter((probe) => probe.status === 'ok' && probe.rawImagesRedacted === true).length
            || bridge?.resultFileProbeSummary.okFileProbeCount
            || 0,
        referenceImageName: basename(input.referenceImagePath || bridge?.resultFileProbeSummary.referenceImageName)
            || undefined
    };
}

function collectBaseBlockers(input: MainImageAcceptanceRecordInput, review: MainImageAcceptanceRecordManualReview): string[] {
    const qaReport = input.qaReport || null;
    const bridge = input.controlledProductQaBridge || null;
    const blockers = [
        ...(qaReport?.qualityClaim.blockers || []),
        ...(bridge?.blockers || [])
    ];
    if (!qaReport) blockers.push('mainImageQaReport is required before writing an acceptance record.');
    if (qaReport?.stage === 'blocked') blockers.push('mainImageQaReport.stage=blocked.');
    if (bridge?.stage === 'blocked') blockers.push('mainImageControlledProductQaBridge.stage=blocked.');
    if (qaReport && qaReport.qualityClaim.allowed !== true) {
        blockers.push('mainImageQaReport.qualityClaim.allowed must be true before acceptance can claim output quality.');
    }
    if (review.decision === 'rejected') {
        blockers.push('acceptance manualReview.decision=rejected.');
    }
    return uniqueStrings([...blockers, ...review.validationErrors], 20);
}

function collectWarnings(input: MainImageAcceptanceRecordInput): string[] {
    return uniqueStrings([
        ...(input.qaReport?.warnings || []),
        ...(input.controlledProductQaBridge?.warnings || []),
        !input.controlledProductQaBridge ? '没有 controlled product QA bridge；记录只按 mainImageQaReport 汇总。' : '',
        !input.resultFileProbes?.length ? '没有传入本次记录的结果文件探针明细；仅使用已有报告摘要。' : ''
    ], 16);
}

function inferStage(
    input: MainImageAcceptanceRecordInput,
    review: MainImageAcceptanceRecordManualReview
): MainImageAcceptanceRecordStage {
    const qaReport = input.qaReport || null;
    const bridge = input.controlledProductQaBridge || null;
    if (!qaReport) return 'needs_qa_report';
    if (qaReport.stage === 'blocked' || bridge?.stage === 'blocked') return 'blocked';
    if (qaReport.qualityClaim.allowed !== true) {
        if (qaReport.stage === 'needs_manual_review') return 'needs_manual_review';
        return 'needs_quality_checks';
    }
    if (review.validationErrors.length > 0) return 'blocked_invalid_review';
    if (review.decision === 'rejected') return 'rejected';
    if (review.decision !== 'approved') return 'needs_acceptance_review';
    return 'recorded';
}

function statusForStage(stage: MainImageAcceptanceRecordStage): DesignAgentOsStatus {
    if (stage === 'recorded') return 'passed';
    if (stage === 'blocked' || stage === 'blocked_invalid_review' || stage === 'rejected') return 'failed';
    return 'needs_review';
}

function buildQualityClaim(
    input: MainImageAcceptanceRecordInput,
    stage: MainImageAcceptanceRecordStage,
    blockers: string[]
): MainImageAcceptanceRecordQualityClaim {
    const requiredChecks = [
        'mainImageQaReport.reportVersion=main-image-qa-report/v0',
        'mainImageQaReport.qualityClaim.allowed=true',
        'acceptance manualReview.decision=approved',
        'acceptance manualReview.reviewer exists',
        'acceptance manualReview.score between 0 and 1',
        'raw image payloads and absolute paths redacted'
    ];
    const allowed = stage === 'recorded'
        && input.qaReport?.qualityClaim.allowed === true
        && blockers.length === 0;
    return {
        allowed,
        reason: allowed
            ? '主图验收记录具备最终 QA report 与有效人工 approved 验收结果。'
            : '当前验收记录不能声明主图输出质量通过。',
        requiredChecks,
        blockers,
        boundary: 'acceptanceRecord 只记录和复核已有结果；不能自行执行 Photoshop、不能替代 mainImageQaReport，也不能外推为完整项目完成。'
    };
}

function buildChecks(input: {
    sourceSummary: MainImageAcceptanceRecordSourceSummary;
    review: MainImageAcceptanceRecordManualReview;
    qualityClaim: MainImageAcceptanceRecordQualityClaim;
    stage: MainImageAcceptanceRecordStage;
}): VerificationCheck[] {
    return [
        {
            id: 'main-image-acceptance-qa-report',
            label: '最终 QA 报告',
            status: input.sourceSummary.qaReportVersion === 'main-image-qa-report/v0'
                ? input.qualityClaim.allowed ? 'passed' : 'needs_review'
                : 'not_run',
            summary: `qaReport=${input.sourceSummary.qaReportVersion}; stage=${input.sourceSummary.qaStage}; claim=${input.qualityClaim.allowed}`
        },
        {
            id: 'main-image-acceptance-bridge',
            label: '受控执行 bridge',
            status: input.sourceSummary.bridgeVersion === 'main-image-controlled-product-qa-bridge/v0'
                ? input.sourceSummary.bridgeStage === 'passed' ? 'passed' : 'needs_review'
                : 'not_run',
            summary: `bridge=${input.sourceSummary.bridgeStage}; screenshotQa=${input.sourceSummary.screenshotQaStage}; readiness=${input.sourceSummary.probeReadinessStage}`
        },
        {
            id: 'main-image-acceptance-result-files',
            label: '结果文件记录',
            status: input.sourceSummary.resultImageCount > 0 ? 'needs_review' : 'not_run',
            summary: `resultImages=${input.sourceSummary.resultImageCount}; fileProbes=${input.sourceSummary.okResultFileProbeCount}/${input.sourceSummary.resultFileProbeCount}`
        },
        {
            id: 'main-image-acceptance-manual-review',
            label: '人工验收',
            status: input.review.decision === 'approved'
                ? input.review.validationErrors.length ? 'failed' : 'passed'
                : input.review.decision === 'rejected'
                    ? 'failed'
                    : 'needs_review',
            summary: `decision=${input.review.decision}; reviewer=${input.review.reviewer || 'none'}; score=${input.review.score ?? 'none'}`
        },
        {
            id: 'main-image-acceptance-redaction',
            label: '脱敏边界',
            status: 'passed',
            summary: '记录只保留 basename、计数、阶段和人工复核摘要，不暴露 raw/base64 图片或绝对路径。'
        },
        {
            id: 'main-image-acceptance-quality-boundary',
            label: '质量声明边界',
            status: input.qualityClaim.allowed ? 'passed' : statusForStage(input.stage),
            summary: input.qualityClaim.reason
        }
    ];
}

function buildNextActions(stage: MainImageAcceptanceRecordStage): string[] {
    if (stage === 'recorded') return ['可将该主图验收记录作为后续导出、打包或人工复核台账的输入。'];
    if (stage === 'needs_qa_report') return ['先生成最终 mainImageQaReport，再写入主图验收记录。'];
    if (stage === 'needs_quality_checks') return ['补齐结果图、文件探针、reference/pixel probe 或截图 QA 检查结果。'];
    if (stage === 'needs_manual_review') return ['基于结果图完成人工复核，并记录 approved / needs_review / rejected。'];
    if (stage === 'needs_acceptance_review') return ['最终 QA 已允许质量声明，但仍需要一次明确的人工验收记录。'];
    if (stage === 'blocked_invalid_review') return ['修正 manualReview.decision、reviewer 或 score 后重新生成验收记录。'];
    if (stage === 'rejected') return ['按人工拒绝原因回到主图设计或执行链路修正，再重新验收。'];
    return ['先处理 QA report 或 controlled bridge 的阻断项，再重新生成验收记录。'];
}

function buildReplay(input: MainImageAcceptanceRecordInput): MainImageAcceptanceRecordReplay {
    return {
        deterministic: true,
        requiredInputs: [
            'mainImageQaReport',
            'manualReview',
            input.controlledProductQaBridge ? 'mainImageControlledProductQaBridge' : '',
            input.resultFileProbes?.length ? 'resultFileProbes' : ''
        ].filter(Boolean),
        suggestedCommand: cleanString(input.replayCommand) || 'npm run smoke:main-image:acceptance-record',
        notes: [
            '验收记录可用同一组 QA report、bridge、file probe 和 manualReview 重建。',
            'replay 不执行 Photoshop 写操作，只验证结果收敛和脱敏边界。'
        ]
    };
}

export function buildMainImageAcceptanceRecord(input: MainImageAcceptanceRecordInput): MainImageAcceptanceRecord {
    const recordedAt = cleanString(input.recordedAt) || new Date().toISOString();
    const manualReview = normalizeManualReview(input.manualReview, recordedAt);
    const sourceSummary = buildSourceSummary(input);
    const stage = inferStage(input, manualReview);
    const status = statusForStage(stage);
    const blockers = collectBaseBlockers(input, manualReview);
    const warnings = collectWarnings(input);
    const qualityClaim = buildQualityClaim(input, stage, blockers);
    const replay = buildReplay(input);
    const checks = buildChecks({
        sourceSummary,
        review: manualReview,
        qualityClaim,
        stage
    });
    const limitations = [
        'mainImageAcceptanceRecord 不执行 Photoshop、不读取图片、不调用视觉模型，只汇总已有结果。',
        '只有 mainImageQaReport.qualityClaim.allowed=true 且人工 approved 验收有效时，canClaimOutputQuality 才能为 true。',
        'canClaimOutputQuality 只覆盖当前主图结果，不代表 SKU、详情页或完整项目已经完成。',
        '记录会脱敏绝对路径和 raw/base64 图片 payload；对外只暴露文件名、计数和检查阶段。'
    ];
    const verificationReport: VerificationReport = {
        reportId: 'main-image-acceptance-record',
        scenario: 'main-image',
        status,
        scope: 'task',
        summary: qualityClaim.allowed
            ? '主图验收记录已具备 QA report 和人工 approved 结果。'
            : `主图验收记录阶段为 ${stage}，仍不能声明输出质量通过。`,
        checks,
        blockers,
        warnings,
        limitations
    };

    return {
        recordVersion: 'main-image-acceptance-record/v0',
        scenario: 'main-image',
        status,
        stage,
        summary: verificationReport.summary,
        sourceSummary,
        manualReview,
        replay,
        qualityClaim,
        canClaimOutputQuality: qualityClaim.allowed,
        canClaimDesignComplete: false,
        checks,
        blockers,
        warnings,
        limitations,
        nextActions: buildNextActions(stage),
        redaction: {
            rawImagesRedacted: true,
            pathsRedacted: true,
            pathPolicy: 'Only basenames, counts, check stages and redacted review notes are exposed.'
        },
        verificationReport
    };
}
