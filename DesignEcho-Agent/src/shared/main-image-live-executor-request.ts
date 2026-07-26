import type {
    DesignAgentOsStatus,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type { MainImageDesignReadinessReport } from './main-image-design-readiness-report';
import type {
    MainImageProductionExecutorDryRunPreview,
    MainImageProductionExecutorDryRunOperationResult
} from './main-image-production-executor-dry-run';

export type MainImageLiveExecutorRequestStatus =
    | 'blocked_missing_readiness_report'
    | 'blocked_readiness_not_live_executor'
    | 'blocked_missing_dry_run'
    | 'blocked_dry_run_not_complete'
    | 'ready_for_executor_dispatch';

export interface MainImageLiveExecutorRequestInput {
    designReadinessReport?: MainImageDesignReadinessReport | null;
    productionExecutorDryRunPreview?: MainImageProductionExecutorDryRunPreview | null;
    requestLabel?: string;
}

export interface MainImageLiveExecutorOperationRequest {
    id: string;
    sourceDryRunId: string;
    requestId: string;
    tool: MainImageProductionExecutorDryRunOperationResult['tool'];
    phase: MainImageProductionExecutorDryRunOperationResult['phase'];
    documentId?: string;
    documentName?: string;
    groupPath?: string[];
    payloadPreview: Record<string, unknown>;
    requiredReadback: string[];
    requiredPostRunReadbackTools: string[];
    sourceContextIds: string[];
    dispatchBoundary: string;
    actualResult: null;
}

export interface MainImageLiveExecutorAcceptancePlan {
    requiredReadbackTools: string[];
    requiredReadback: string[];
    requiresActualBounds: boolean;
    requiresAcceptanceSnapshot: boolean;
    requiresQaReport: true;
    requiresManualReviewBeforeQualityClaim: true;
    boundary: string;
}

export interface MainImageLiveExecutorRequestPackage {
    version: 'main-image-live-executor-request/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageLiveExecutorRequestStatus;
    requestLabel: string;
    canDispatchLiveExecutor: boolean;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    operationRequests: MainImageLiveExecutorOperationRequest[];
    operationCount: number;
    acceptancePlan: MainImageLiveExecutorAcceptancePlan;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    verificationReport: VerificationReport;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

const EMPTY_ACCEPTANCE_PLAN: MainImageLiveExecutorAcceptancePlan = {
    requiredReadbackTools: [],
    requiredReadback: [],
    requiresActualBounds: false,
    requiresAcceptanceSnapshot: false,
    requiresQaReport: true,
    requiresManualReviewBeforeQualityClaim: true,
    boundary: 'No live executor operation can run until readiness and dry-run preview are both ready.'
};

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function sanitizeUnknown(value: unknown): unknown {
    if (typeof value === 'string') return cleanString(value);
    if (Array.isArray(value)) return value.map(sanitizeUnknown);
    if (!value || typeof value !== 'object') return value;

    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        sanitized[cleanString(key)] = sanitizeUnknown(item);
    }
    return sanitized;
}

function sanitizePayloadPreview(value: Record<string, unknown>): Record<string, unknown> {
    const sanitized = sanitizeUnknown(value);
    return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? sanitized as Record<string, unknown>
        : {};
}

function inferStatus(input: MainImageLiveExecutorRequestInput): MainImageLiveExecutorRequestStatus {
    if (!input.designReadinessReport) return 'blocked_missing_readiness_report';
    if (input.designReadinessReport.status !== 'ready_for_live_executor') {
        return 'blocked_readiness_not_live_executor';
    }
    if (!input.productionExecutorDryRunPreview) return 'blocked_missing_dry_run';
    if (input.productionExecutorDryRunPreview.status !== 'completed_dry_run') {
        return 'blocked_dry_run_not_complete';
    }
    return 'ready_for_executor_dispatch';
}

function toVerificationStatus(status: MainImageLiveExecutorRequestStatus): DesignAgentOsStatus {
    return status === 'ready_for_executor_dispatch' ? 'passed' : 'failed';
}

function collectBlockers(
    input: MainImageLiveExecutorRequestInput,
    status: MainImageLiveExecutorRequestStatus
): string[] {
    const blockers = [
        ...(input.designReadinessReport?.blockers || []),
        ...(input.productionExecutorDryRunPreview?.blockers || [])
    ];

    if (status === 'blocked_missing_readiness_report') {
        blockers.push('main_image_design_readiness_report_required');
    }
    if (status === 'blocked_readiness_not_live_executor') {
        blockers.push('main_image_readiness_must_be_ready_for_live_executor');
    }
    if (status === 'blocked_missing_dry_run') {
        blockers.push('main_image_executor_dry_run_required');
    }
    if (status === 'blocked_dry_run_not_complete') {
        blockers.push('main_image_executor_dry_run_must_be_completed');
    }

    return cleanStrings(blockers);
}

function collectWarnings(input: MainImageLiveExecutorRequestInput): string[] {
    return cleanStrings([
        ...(input.designReadinessReport?.warnings || []),
        ...(input.productionExecutorDryRunPreview?.warnings || [])
    ]);
}

function toOperationRequest(
    operation: MainImageProductionExecutorDryRunOperationResult,
    index: number
): MainImageLiveExecutorOperationRequest {
    return {
        id: `live-request-${String(index + 1).padStart(3, '0')}-${operation.requestId}`,
        sourceDryRunId: operation.id,
        requestId: operation.requestId,
        tool: operation.tool,
        phase: operation.phase,
        documentId: operation.documentId,
        documentName: cleanString(operation.documentName) || undefined,
        groupPath: cleanStrings(operation.groupPath),
        payloadPreview: sanitizePayloadPreview(operation.payloadPreview),
        requiredReadback: cleanStrings(operation.requiredReadback),
        requiredPostRunReadbackTools: cleanStrings(operation.requiredPostRunReadbackTools),
        sourceContextIds: cleanStrings(operation.sourceContextIds),
        dispatchBoundary: 'This is a request package for a future live executor; this helper does not call Photoshop.',
        actualResult: null
    };
}

function buildOperationRequests(
    input: MainImageLiveExecutorRequestInput,
    status: MainImageLiveExecutorRequestStatus
): MainImageLiveExecutorOperationRequest[] {
    if (status !== 'ready_for_executor_dispatch') return [];
    return (input.productionExecutorDryRunPreview?.operationResults || []).map(toOperationRequest);
}

function buildAcceptancePlan(
    dryRun: MainImageProductionExecutorDryRunPreview | null | undefined,
    operationRequests: MainImageLiveExecutorOperationRequest[]
): MainImageLiveExecutorAcceptancePlan {
    if (!dryRun || operationRequests.length === 0) return EMPTY_ACCEPTANCE_PLAN;

    return {
        requiredReadbackTools: cleanStrings(dryRun.readbackPlan.requiredTools),
        requiredReadback: cleanStrings(dryRun.readbackPlan.requiredReadback),
        requiresActualBounds: dryRun.readbackPlan.requiresActualBounds === true,
        requiresAcceptanceSnapshot: dryRun.readbackPlan.requiresAcceptanceSnapshot === true,
        requiresQaReport: true,
        requiresManualReviewBeforeQualityClaim: true,
        boundary: 'After the future live executor runs, actual bounds, document state, export results, screenshot/pixel QA and manual review must be read back before any quality claim.'
    };
}

function buildChecks(
    status: MainImageLiveExecutorRequestStatus,
    operationCount: number,
    acceptancePlan: MainImageLiveExecutorAcceptancePlan
): VerificationCheck[] {
    return [
        {
            id: 'readiness-report',
            label: '主图执行 readiness',
            status: status === 'blocked_missing_readiness_report' || status === 'blocked_readiness_not_live_executor'
                ? 'failed'
                : 'passed',
            summary: `status=${status}`
        },
        {
            id: 'dry-run-operations',
            label: 'dry-run 操作队列',
            status: status === 'ready_for_executor_dispatch' ? 'passed' : 'not_run',
            summary: `operationRequests=${operationCount}`
        },
        {
            id: 'post-run-acceptance',
            label: '执行后验收要求',
            status: status === 'ready_for_executor_dispatch' ? 'needs_review' : 'not_run',
            summary: `tools=${acceptancePlan.requiredReadbackTools.length}; actualBounds=${acceptancePlan.requiresActualBounds}; snapshot=${acceptancePlan.requiresAcceptanceSnapshot}`
        }
    ];
}

export function buildMainImageLiveExecutorRequestPackage(
    input: MainImageLiveExecutorRequestInput
): MainImageLiveExecutorRequestPackage {
    const status = inferStatus(input);
    const verificationStatus = toVerificationStatus(status);
    const operationRequests = buildOperationRequests(input, status);
    const acceptancePlan = buildAcceptancePlan(input.productionExecutorDryRunPreview, operationRequests);
    const blockers = collectBlockers(input, status);
    const warnings = collectWarnings(input);
    const limitations = [
        'mainImageLiveExecutorRequestPackage 只生成 live executor 请求包，不执行 Photoshop。',
        'operationRequests 来自 dry-run preview，actualResult 固定为 null，不能伪造 layerId、bounds、截图或导出结果。',
        'canDispatchLiveExecutor 只表示请求包可交给后续独立 executor，不代表已经执行。',
        '执行后必须读回 Photoshop 状态、截图 / pixel probe 和人工验收，才能进入质量声明。'
    ];
    const verificationReport: VerificationReport = {
        reportId: 'main-image-live-executor-request',
        scenario: 'main-image',
        status: verificationStatus,
        scope: 'task',
        summary: status === 'ready_for_executor_dispatch'
            ? '主图 live executor 请求包已准备好，但尚未执行 Photoshop。'
            : `主图 live executor 请求包未就绪：${status}`,
        checks: buildChecks(status, operationRequests.length, acceptancePlan),
        blockers,
        warnings,
        limitations
    };

    return {
        version: 'main-image-live-executor-request/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        requestLabel: cleanString(input.requestLabel) || 'main-image-live-executor-request',
        canDispatchLiveExecutor: status === 'ready_for_executor_dispatch',
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        operationRequests,
        operationCount: operationRequests.length,
        acceptancePlan,
        blockers,
        warnings,
        limitations,
        verificationReport
    };
}
