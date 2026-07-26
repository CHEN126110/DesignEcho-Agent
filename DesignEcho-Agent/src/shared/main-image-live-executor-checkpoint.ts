import type {
    DesignAgentOsStatus,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type {
    MainImageLiveExecutorOperationRequest,
    MainImageLiveExecutorRequestPackage
} from './main-image-live-executor-request';

export type MainImageLiveExecutorCheckpointStatus =
    | 'blocked_missing_request_package'
    | 'blocked_request_not_ready'
    | 'blocked_missing_operation_requests'
    | 'blocked_requires_explicit_checkpoint'
    | 'blocked_photoshop_unavailable'
    | 'ready_for_live_executor_run';

export type MainImageLiveExecutorScope =
    | 'disposable-document'
    | 'active-document'
    | 'project-document';

export interface MainImageLiveExecutorCheckpointConnection {
    connected?: boolean;
    documentWriteAvailable?: boolean;
    source?: string;
    currentDocumentId?: string | number | null;
    activeDocumentName?: string | null;
}

export interface MainImageLiveExecutorCheckpointInput {
    requestPackage?: MainImageLiveExecutorRequestPackage | null;
    approvedLiveExecution?: boolean;
    photoshopConnection?: MainImageLiveExecutorCheckpointConnection | null;
    executionScope?: MainImageLiveExecutorScope;
    maxOperationCount?: number;
}

export interface MainImageLiveExecutorRunGuard {
    executionScope: MainImageLiveExecutorScope;
    approvedLiveExecution: boolean;
    photoshopConnected: boolean;
    documentWriteAvailable: boolean;
    maxOperationCount: number;
    stopOnFirstFailure: true;
    requireReadbackAfterEachOperation: true;
    requireFinalAcceptanceSnapshot: true;
    requireManualReviewBeforeQualityClaim: true;
    failurePolicy: string;
}

export interface MainImageLiveExecutorCheckpoint {
    version: 'main-image-live-executor-checkpoint/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageLiveExecutorCheckpointStatus;
    canStartLiveExecutor: boolean;
    checkpointOnly: true;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    liveExecutionRequiresSeparateRunner: true;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    operationRequests: MainImageLiveExecutorOperationRequest[];
    operationCount: number;
    readbackTools: string[];
    readbackRequirements: string[];
    runGuard: MainImageLiveExecutorRunGuard;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    verificationReport: VerificationReport;
}

const DEFAULT_MAX_OPERATION_COUNT = 80;

function cleanString(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function normalizeConnection(
    connection: MainImageLiveExecutorCheckpointConnection | null | undefined
): Required<Omit<MainImageLiveExecutorCheckpointConnection, 'currentDocumentId'>> & {
    currentDocumentId: string;
} {
    return {
        connected: connection?.connected === true,
        documentWriteAvailable: connection?.documentWriteAvailable === true,
        source: cleanString(connection?.source) || 'not-provided',
        currentDocumentId: cleanString(connection?.currentDocumentId),
        activeDocumentName: cleanString(connection?.activeDocumentName)
    };
}

function normalizeScope(value: unknown): MainImageLiveExecutorScope {
    if (value === 'active-document' || value === 'project-document') return value;
    return 'disposable-document';
}

function normalizeMaxOperationCount(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_MAX_OPERATION_COUNT;
    return Math.max(1, Math.min(DEFAULT_MAX_OPERATION_COUNT, Math.floor(numeric)));
}

function inferStatus(input: MainImageLiveExecutorCheckpointInput): MainImageLiveExecutorCheckpointStatus {
    const requestPackage = input.requestPackage;
    if (!requestPackage) return 'blocked_missing_request_package';
    if (requestPackage.status !== 'ready_for_executor_dispatch' || requestPackage.canDispatchLiveExecutor !== true) {
        return 'blocked_request_not_ready';
    }
    if (!requestPackage.operationRequests.length) return 'blocked_missing_operation_requests';
    if (input.approvedLiveExecution !== true) return 'blocked_requires_explicit_checkpoint';

    const connection = normalizeConnection(input.photoshopConnection);
    if (!connection.connected || !connection.documentWriteAvailable) return 'blocked_photoshop_unavailable';

    return 'ready_for_live_executor_run';
}

function buildRunGuard(
    input: MainImageLiveExecutorCheckpointInput,
    connection: ReturnType<typeof normalizeConnection>
): MainImageLiveExecutorRunGuard {
    return {
        executionScope: normalizeScope(input.executionScope),
        approvedLiveExecution: input.approvedLiveExecution === true,
        photoshopConnected: connection.connected,
        documentWriteAvailable: connection.documentWriteAvailable,
        maxOperationCount: normalizeMaxOperationCount(input.maxOperationCount),
        stopOnFirstFailure: true,
        requireReadbackAfterEachOperation: true,
        requireFinalAcceptanceSnapshot: true,
        requireManualReviewBeforeQualityClaim: true,
        failurePolicy: 'Stop immediately on the first failed Photoshop operation, capture available readback results, and do not claim design quality.'
    };
}

function collectBlockers(
    input: MainImageLiveExecutorCheckpointInput,
    status: MainImageLiveExecutorCheckpointStatus
): string[] {
    const blockers = [...(input.requestPackage?.blockers || [])];
    if (status === 'blocked_missing_request_package') blockers.push('main_image_live_executor_request_package_required');
    if (status === 'blocked_request_not_ready') blockers.push('main_image_live_executor_request_package_must_be_ready');
    if (status === 'blocked_missing_operation_requests') blockers.push('main_image_live_executor_operation_requests_required');
    if (status === 'blocked_requires_explicit_checkpoint') blockers.push('explicit_live_executor_checkpoint_required');
    if (status === 'blocked_photoshop_unavailable') blockers.push('photoshop_connection_and_document_write_required');
    return Array.from(new Set(blockers.map(cleanString).filter(Boolean)));
}

function toVerificationStatus(status: MainImageLiveExecutorCheckpointStatus): DesignAgentOsStatus {
    return status === 'ready_for_live_executor_run' ? 'needs_review' : 'failed';
}

function buildChecks(input: {
    status: MainImageLiveExecutorCheckpointStatus;
    operationCount: number;
    runGuard: MainImageLiveExecutorRunGuard;
}): VerificationCheck[] {
    return [
        {
            id: 'request-package',
            label: 'live executor 请求包',
            status: input.status === 'blocked_missing_request_package' || input.status === 'blocked_request_not_ready'
                ? 'failed'
                : 'passed',
            summary: `status=${input.status}; operations=${input.operationCount}`
        },
        {
            id: 'explicit-checkpoint',
            label: '显式执行授权',
            status: input.runGuard.approvedLiveExecution ? 'passed' : 'failed',
            summary: `approved=${input.runGuard.approvedLiveExecution}`
        },
        {
            id: 'photoshop-connection',
            label: 'Photoshop 写入连接',
            status: input.runGuard.photoshopConnected && input.runGuard.documentWriteAvailable ? 'passed' : 'failed',
            summary: `connected=${input.runGuard.photoshopConnected}; writable=${input.runGuard.documentWriteAvailable}`
        },
        {
            id: 'post-run-readback',
            label: '执行后读回与验收',
            status: input.status === 'ready_for_live_executor_run' ? 'needs_review' : 'not_run',
            summary: 'requires operation-level readback, final acceptance snapshot and manual review'
        }
    ];
}

export function buildMainImageLiveExecutorCheckpoint(
    input: MainImageLiveExecutorCheckpointInput
): MainImageLiveExecutorCheckpoint {
    const status = inferStatus(input);
    const connection = normalizeConnection(input.photoshopConnection);
    const runGuard = buildRunGuard(input, connection);
    const canStartLiveExecutor = status === 'ready_for_live_executor_run';
    const operationRequests = canStartLiveExecutor ? input.requestPackage?.operationRequests || [] : [];
    const operationCount = operationRequests.length;
    const readbackTools = canStartLiveExecutor
        ? cleanStrings(input.requestPackage?.acceptancePlan.requiredReadbackTools)
        : [];
    const readbackRequirements = canStartLiveExecutor
        ? cleanStrings(input.requestPackage?.acceptancePlan.requiredReadback)
        : [];
    const blockers = collectBlockers(input, status);
    const warnings = Array.from(new Set([
        ...(input.requestPackage?.warnings || []),
        runGuard.executionScope === 'active-document'
            ? 'active-document execution can affect the user document; prefer disposable-document for validation runs.'
            : ''
    ].map(cleanString).filter(Boolean)));
    const checks = buildChecks({ status, operationCount, runGuard });
    const verificationReport: VerificationReport = {
        reportId: 'main-image-live-executor-checkpoint',
        scenario: 'main-image',
        status: toVerificationStatus(status),
        scope: 'task',
        summary: canStartLiveExecutor
            ? '主图 live executor checkpoint 已就绪；仍需要单独 live runner 执行并读回验收。'
            : `主图 live executor checkpoint 未就绪：${status}`,
        checks,
        blockers,
        warnings,
        limitations: [
            'checkpoint ready 只表示可进入单独 live runner，不表示 Photoshop 已执行。',
            '必须等 live runner 返回 actualResult、actualBounds、snapshot 和 QA 后才能声明设计质量。'
        ]
    };

    return {
        version: 'main-image-live-executor-checkpoint/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        canStartLiveExecutor,
        checkpointOnly: true,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        liveExecutionRequiresSeparateRunner: true,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        operationRequests,
        operationCount,
        readbackTools,
        readbackRequirements,
        runGuard,
        blockers,
        warnings,
        limitations: [
            'live executor checkpoint 只判断是否允许进入单独 live runner；本 helper 不执行 Photoshop。',
            'ready_for_live_executor_run 不等于已经创建文档、置入图片、导出文件或完成设计验收。',
            '真实执行必须逐步调用 Photoshop 工具，并在每步后读回 requiredReadback。',
            '质量声明必须等待 final acceptance snapshot、结果图 QA、pixel probe 和人工复核。'
        ],
        verificationReport
    };
}
