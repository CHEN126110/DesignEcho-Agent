import type {
    DesignAgentOsStatus,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type {
    MainImageLiveExecutorCheckpoint,
    MainImageLiveExecutorScope
} from './main-image-live-executor-checkpoint';
import type {
    MainImageLiveExecutorOperationRequest
} from './main-image-live-executor-request';

export type MainImageLiveExecutorRunStatus =
    | 'blocked_missing_checkpoint'
    | 'blocked_checkpoint_not_ready'
    | 'blocked_non_disposable_scope'
    | 'blocked_missing_tool_adapter'
    | 'blocked_operation_count_exceeded'
    | 'completed_requires_review'
    | 'failed_operation'
    | 'failed_readback'
    | 'failed_final_snapshot';

export interface MainImageLiveExecutorAdapterOperationResult {
    success: boolean;
    summary?: string;
    error?: string;
    actualResult?: Record<string, unknown> | null;
}

export interface MainImageLiveExecutorAdapterReadbackResult {
    success: boolean;
    summary?: string;
    error?: string;
    data?: Record<string, unknown> | null;
}

export interface MainImageLiveExecutorAdapter {
    executeOperation(
        request: MainImageLiveExecutorOperationRequest
    ): Promise<MainImageLiveExecutorAdapterOperationResult> | MainImageLiveExecutorAdapterOperationResult;
    readbackAfterOperation?(
        request: MainImageLiveExecutorOperationRequest,
        toolName: string,
        operationResult: MainImageLiveExecutorAdapterOperationResult
    ): Promise<MainImageLiveExecutorAdapterReadbackResult> | MainImageLiveExecutorAdapterReadbackResult;
    captureFinalAcceptanceSnapshot?(): Promise<MainImageLiveExecutorAdapterReadbackResult> | MainImageLiveExecutorAdapterReadbackResult;
}

export interface MainImageLiveExecutorRunInput {
    checkpoint?: MainImageLiveExecutorCheckpoint | null;
    adapter?: MainImageLiveExecutorAdapter | null;
    allowNonDisposableScope?: boolean;
}

export interface MainImageLiveExecutorReadbackRunResult {
    toolName: string;
    success: boolean;
    summary: string;
    error?: string;
    data: unknown;
}

export interface MainImageLiveExecutorOperationRunResult {
    requestId: string;
    sourceRequestId: string;
    tool: MainImageLiveExecutorOperationRequest['tool'];
    phase: MainImageLiveExecutorOperationRequest['phase'];
    success: boolean;
    summary: string;
    error?: string;
    actualResult: unknown;
    readbackResults: MainImageLiveExecutorReadbackRunResult[];
}

export interface MainImageLiveExecutorRunResult {
    version: 'main-image-live-executor-runner/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageLiveExecutorRunStatus;
    executionScope: MainImageLiveExecutorScope;
    executedWithAdapter: boolean;
    mayWritePhotoshop: boolean;
    operationCount: number;
    executedOperationCount: number;
    successfulOperationCount: number;
    failedOperationCount: number;
    failedReadbackCount: number;
    operationResults: MainImageLiveExecutorOperationRunResult[];
    finalAcceptanceSnapshot: MainImageLiveExecutorReadbackRunResult | null;
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    requiresManualReviewBeforeQualityClaim: true;
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
        const cleanKey = cleanString(key);
        if (/raw|base64|imageData|binary|buffer/i.test(cleanKey)) {
            sanitized[cleanKey] = '[redacted-payload]';
            continue;
        }
        sanitized[cleanKey] = sanitizeUnknown(item);
    }
    return sanitized;
}

function getCheckpointScope(checkpoint: MainImageLiveExecutorCheckpoint | null | undefined): MainImageLiveExecutorScope {
    return checkpoint?.runGuard.executionScope || 'disposable-document';
}

function toVerificationStatus(status: MainImageLiveExecutorRunStatus): DesignAgentOsStatus {
    if (status === 'completed_requires_review') return 'needs_review';
    return 'failed';
}

function statusSummary(status: MainImageLiveExecutorRunStatus): string {
    if (status === 'completed_requires_review') {
        return '主图 live runner 已执行工具队列并完成读回，但仍需要截图 QA 和人工复核。';
    }
    return `主图 live runner 未完成：${status}`;
}

function buildReadbackTools(request: MainImageLiveExecutorOperationRequest): string[] {
    return cleanStrings(request.requiredPostRunReadbackTools);
}

function makeReadbackResult(
    toolName: string,
    result: MainImageLiveExecutorAdapterReadbackResult
): MainImageLiveExecutorReadbackRunResult {
    return {
        toolName,
        success: result.success === true,
        summary: cleanString(result.summary) || (result.success ? `readback ${toolName}` : `readback ${toolName} failed`),
        error: cleanString(result.error) || undefined,
        data: sanitizeUnknown(result.data || null)
    };
}

function makeOperationResult(
    request: MainImageLiveExecutorOperationRequest,
    result: MainImageLiveExecutorAdapterOperationResult,
    readbackResults: MainImageLiveExecutorReadbackRunResult[]
): MainImageLiveExecutorOperationRunResult {
    return {
        requestId: request.id,
        sourceRequestId: request.requestId,
        tool: request.tool,
        phase: request.phase,
        success: result.success === true,
        summary: cleanString(result.summary) || (result.success ? `executed ${request.tool}` : `failed ${request.tool}`),
        error: cleanString(result.error) || undefined,
        actualResult: sanitizeUnknown(result.actualResult || null),
        readbackResults
    };
}

function buildChecks(input: {
    status: MainImageLiveExecutorRunStatus;
    operationCount: number;
    executedOperationCount: number;
    failedOperationCount: number;
    failedReadbackCount: number;
    finalSnapshotCaptured: boolean;
}): VerificationCheck[] {
    return [
        {
            id: 'checkpoint-ready',
            label: 'live runner 入口门禁',
            status: input.status === 'blocked_missing_checkpoint' || input.status === 'blocked_checkpoint_not_ready'
                ? 'failed'
                : 'passed',
            summary: `status=${input.status}; operations=${input.operationCount}`
        },
        {
            id: 'operation-execution',
            label: '工具队列执行',
            status: input.failedOperationCount > 0
                ? 'failed'
                : input.executedOperationCount === input.operationCount && input.operationCount > 0
                    ? 'passed'
                    : 'not_run',
            summary: `executed=${input.executedOperationCount}; failed=${input.failedOperationCount}`
        },
        {
            id: 'operation-readback',
            label: '逐步读回',
            status: input.failedReadbackCount > 0
                ? 'failed'
                : input.executedOperationCount > 0
                    ? 'needs_review'
                    : 'not_run',
            summary: `failedReadback=${input.failedReadbackCount}`
        },
        {
            id: 'final-acceptance-snapshot',
            label: '最终验收快照',
            status: input.finalSnapshotCaptured ? 'needs_review' : 'not_run',
            summary: input.finalSnapshotCaptured ? 'final acceptance snapshot captured' : 'final acceptance snapshot missing'
        },
        {
            id: 'manual-quality-review',
            label: '人工质量复核',
            status: 'needs_review',
            summary: '任何 live runner 结果都必须经过截图 QA、pixel probe 和人工复核后才能声明质量。'
        }
    ];
}

function makeResult(input: {
    status: MainImageLiveExecutorRunStatus;
    checkpoint?: MainImageLiveExecutorCheckpoint | null;
    executedWithAdapter?: boolean;
    operationResults?: MainImageLiveExecutorOperationRunResult[];
    finalAcceptanceSnapshot?: MainImageLiveExecutorReadbackRunResult | null;
    blockers?: string[];
    warnings?: string[];
    limitations?: string[];
}): MainImageLiveExecutorRunResult {
    const operationResults = input.operationResults || [];
    const failedOperationCount = operationResults.filter((item) => !item.success).length;
    const failedReadbackCount = operationResults
        .flatMap((item) => item.readbackResults)
        .filter((item) => !item.success).length;
    const operationCount = input.checkpoint?.operationCount || 0;
    const verificationStatus = toVerificationStatus(input.status);
    const checks = buildChecks({
        status: input.status,
        operationCount,
        executedOperationCount: operationResults.length,
        failedOperationCount,
        failedReadbackCount,
        finalSnapshotCaptured: input.finalAcceptanceSnapshot?.success === true
    });
    return {
        version: 'main-image-live-executor-runner/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status: input.status,
        executionScope: getCheckpointScope(input.checkpoint),
        executedWithAdapter: input.executedWithAdapter === true,
        mayWritePhotoshop: input.executedWithAdapter === true,
        operationCount,
        executedOperationCount: operationResults.length,
        successfulOperationCount: operationResults.length - failedOperationCount,
        failedOperationCount,
        failedReadbackCount,
        operationResults,
        finalAcceptanceSnapshot: input.finalAcceptanceSnapshot || null,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        requiresManualReviewBeforeQualityClaim: true,
        blockers: cleanStrings(input.blockers || []),
        warnings: cleanStrings(input.warnings || []),
        limitations: [
            'live runner 只证明工具队列按 adapter 返回执行过；它本身不证明审美质量。',
            'actualResult 必须来自 adapter/Photoshop 工具返回，不能由计划值伪造。',
            '即使所有工具成功，也必须等待截图 QA、pixel probe 和人工复核后才能声明设计质量。',
            ...(input.limitations || [])
        ],
        verificationReport: {
            reportId: 'main-image-live-executor-runner',
            scenario: 'main-image',
            status: verificationStatus,
            scope: 'task',
            summary: statusSummary(input.status),
            checks,
            blockers: cleanStrings(input.blockers || []),
            warnings: cleanStrings(input.warnings || []),
            limitations: [
                'runner 结果不是最终设计质量验收。',
                '生产文档执行必须另有显式授权；默认只允许 disposable-document 验证。'
            ]
        }
    };
}

async function executeOperationSafely(
    adapter: MainImageLiveExecutorAdapter,
    request: MainImageLiveExecutorOperationRequest
): Promise<MainImageLiveExecutorAdapterOperationResult> {
    try {
        return await adapter.executeOperation(request);
    } catch (error) {
        return {
            success: false,
            summary: `exception while executing ${request.tool}`,
            error: error instanceof Error ? error.message : String(error),
            actualResult: null
        };
    }
}

async function readbackSafely(
    adapter: MainImageLiveExecutorAdapter,
    request: MainImageLiveExecutorOperationRequest,
    toolName: string,
    operationResult: MainImageLiveExecutorAdapterOperationResult
): Promise<MainImageLiveExecutorReadbackRunResult> {
    if (!adapter.readbackAfterOperation) {
        return makeReadbackResult(toolName, {
            success: false,
            summary: `readback adapter missing for ${toolName}`,
            error: 'readback_adapter_missing'
        });
    }

    try {
        const result = await adapter.readbackAfterOperation(request, toolName, operationResult);
        return makeReadbackResult(toolName, result);
    } catch (error) {
        return makeReadbackResult(toolName, {
            success: false,
            summary: `exception while reading ${toolName}`,
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

async function captureFinalSnapshotSafely(
    adapter: MainImageLiveExecutorAdapter
): Promise<MainImageLiveExecutorReadbackRunResult> {
    if (!adapter.captureFinalAcceptanceSnapshot) {
        return makeReadbackResult('getAcceptanceSnapshot', {
            success: false,
            summary: 'final acceptance snapshot adapter missing',
            error: 'final_acceptance_snapshot_adapter_missing'
        });
    }

    try {
        const result = await adapter.captureFinalAcceptanceSnapshot();
        return makeReadbackResult('getAcceptanceSnapshot', result);
    } catch (error) {
        return makeReadbackResult('getAcceptanceSnapshot', {
            success: false,
            summary: 'exception while capturing final acceptance snapshot',
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

export async function runMainImageLiveExecutor(
    input: MainImageLiveExecutorRunInput
): Promise<MainImageLiveExecutorRunResult> {
    const checkpoint = input.checkpoint;
    if (!checkpoint) {
        return makeResult({
            status: 'blocked_missing_checkpoint',
            blockers: ['main_image_live_executor_checkpoint_required']
        });
    }

    if (checkpoint.status !== 'ready_for_live_executor_run' || checkpoint.canStartLiveExecutor !== true) {
        return makeResult({
            status: 'blocked_checkpoint_not_ready',
            checkpoint,
            blockers: ['main_image_live_executor_checkpoint_must_be_ready'],
            warnings: checkpoint.warnings
        });
    }

    if (checkpoint.runGuard.executionScope !== 'disposable-document' && input.allowNonDisposableScope !== true) {
        return makeResult({
            status: 'blocked_non_disposable_scope',
            checkpoint,
            blockers: ['non_disposable_scope_requires_explicit_override'],
            warnings: checkpoint.warnings
        });
    }

    const adapter = input.adapter;
    if (!adapter) {
        return makeResult({
            status: 'blocked_missing_tool_adapter',
            checkpoint,
            blockers: ['main_image_live_executor_tool_adapter_required'],
            warnings: checkpoint.warnings
        });
    }

    if (checkpoint.operationCount > checkpoint.runGuard.maxOperationCount) {
        return makeResult({
            status: 'blocked_operation_count_exceeded',
            checkpoint,
            blockers: [`operation_count_exceeded=${checkpoint.operationCount}/${checkpoint.runGuard.maxOperationCount}`],
            warnings: checkpoint.warnings
        });
    }

    const operationResults: MainImageLiveExecutorOperationRunResult[] = [];
    for (const request of checkpoint.operationRequests) {
        const operationResult = await executeOperationSafely(adapter, request);
        const readbackResults: MainImageLiveExecutorReadbackRunResult[] = [];

        if (operationResult.success === true) {
            for (const toolName of buildReadbackTools(request)) {
                const readback = await readbackSafely(adapter, request, toolName, operationResult);
                readbackResults.push(readback);
                if (!readback.success) {
                    operationResults.push(makeOperationResult(request, operationResult, readbackResults));
                    return makeResult({
                        status: 'failed_readback',
                        checkpoint,
                        executedWithAdapter: true,
                        operationResults,
                        blockers: [`readback_failed=${toolName}`],
                        warnings: checkpoint.warnings
                    });
                }
            }
        }

        operationResults.push(makeOperationResult(request, operationResult, readbackResults));
        if (operationResult.success !== true) {
            return makeResult({
                status: 'failed_operation',
                checkpoint,
                executedWithAdapter: true,
                operationResults,
                blockers: [`operation_failed=${request.tool}`],
                warnings: checkpoint.warnings
            });
        }
    }

    const finalAcceptanceSnapshot = checkpoint.runGuard.requireFinalAcceptanceSnapshot
        ? await captureFinalSnapshotSafely(adapter)
        : null;

    if (checkpoint.runGuard.requireFinalAcceptanceSnapshot && finalAcceptanceSnapshot?.success !== true) {
        return makeResult({
            status: 'failed_final_snapshot',
            checkpoint,
            executedWithAdapter: true,
            operationResults,
            finalAcceptanceSnapshot,
            blockers: ['final_acceptance_snapshot_required'],
            warnings: checkpoint.warnings
        });
    }

    return makeResult({
        status: 'completed_requires_review',
        checkpoint,
        executedWithAdapter: true,
        operationResults,
        finalAcceptanceSnapshot,
        warnings: checkpoint.warnings
    });
}
