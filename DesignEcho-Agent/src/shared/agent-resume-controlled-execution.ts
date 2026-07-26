import type { AgentResumeExecutionGate } from './agent-resume-execution-gate';
import { sanitizeAgentResumePlanningValue } from './agent-resume-planning';

export type AgentResumeControlledExecutionRequestVersion = 'agent-resume-controlled-execution-request/v0';
export type AgentResumeControlledExecutionRunnerVersion = 'agent-resume-controlled-execution-runner/v0';

export type AgentResumeControlledExecutionRequestStatus =
    | 'not_applicable'
    | 'blocked_execution_gate_not_ready'
    | 'blocked_execution_disabled'
    | 'ready_for_controlled_runner';

export type AgentResumeControlledExecutionRunnerStatus =
    | 'not_applicable'
    | 'blocked_request_not_ready'
    | 'blocked_adapter_required'
    | 'blocked_live_write_permission_missing'
    | 'blocked_live_adapter_required'
    | 'blocked_live_operation_params_required'
    | 'blocked_readback_adapter_required'
    | 'completed_dry_run'
    | 'completed_fake_adapter_verified'
    | 'completed_live_adapter_verified'
    | 'failed_write_operation'
    | 'failed_readback';

export type AgentResumeControlledExecutionRunnerTarget =
    | 'dry-run'
    | 'fake-adapter'
    | 'live-photoshop';

export type AgentResumeControlledExecutionState =
    | 'not_started'
    | 'dry_run'
    | 'completed'
    | 'failed';

export type AgentResumeControlledVerificationStatus =
    | 'not_run'
    | 'passed'
    | 'failed';

export interface AgentResumeControlledOperationRequest {
    operationId: string;
    toolName: string;
    params?: unknown;
    paramsSummary?: string;
    readbackTargets: string[];
}

export interface AgentResumeControlledExecutionRequestInput {
    executionGate?: AgentResumeExecutionGate;
    enableControlledExecutionRequest?: boolean;
    requestId?: string;
}

export interface AgentResumeControlledExecutionRequest {
    version: AgentResumeControlledExecutionRequestVersion;
    status: AgentResumeControlledExecutionRequestStatus;
    requestId?: string;
    executionGateStatus?: AgentResumeExecutionGate['status'];
    writesPerformed: false;
    rawPayloadRedacted: true;
    shouldRunPhotoshop: false;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requiresControlledRunner: true;
    requiresReadbackAfterEachWrite: true;
    canStartControlledRunner: boolean;
    approvedWriteTools: string[];
    readbackTargets: string[];
    operationRequests: AgentResumeControlledOperationRequest[];
    executionPlan?: unknown;
    blockers: string[];
    warnings: string[];
}

export interface AgentResumeControlledExecutionRunnerInput {
    request?: AgentResumeControlledExecutionRequest;
    allowPhotoshopWrites?: boolean;
    executionTarget?: AgentResumeControlledExecutionRunnerTarget;
    adapter?: AgentResumeControlledExecutionAdapter;
}

export interface AgentResumeControlledAdapterResult {
    success?: boolean;
    error?: string;
    data?: unknown;
}

export interface AgentResumeControlledExecutionAdapter {
    runWriteOperation(operation: AgentResumeControlledOperationRequest): AgentResumeControlledAdapterResult;
    readbackAfterOperation?(
        operation: AgentResumeControlledOperationRequest,
        target: string
    ): AgentResumeControlledAdapterResult;
}

export interface AgentResumeControlledOperationResult {
    operationId: string;
    toolName: string;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface AgentResumeControlledReadbackResult {
    operationId: string;
    toolName: string;
    target: string;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface AgentResumeControlledExecutionRun {
    version: AgentResumeControlledExecutionRunnerVersion;
    status: AgentResumeControlledExecutionRunnerStatus;
    requestId?: string;
    requestStatus?: AgentResumeControlledExecutionRequestStatus;
    executionTarget: AgentResumeControlledExecutionRunnerTarget;
    fakeAdapterOnly: boolean;
    executionState: AgentResumeControlledExecutionState;
    verificationStatus: AgentResumeControlledVerificationStatus;
    writesPerformed: boolean;
    rawPayloadRedacted: true;
    shouldRunPhotoshop: boolean;
    mustNotRunWriteTools: boolean;
    mustNotClaimTaskCompletion: true;
    plannedWriteTools: string[];
    executedWriteTools: string[];
    readbackTargets: string[];
    operationRequests: AgentResumeControlledOperationRequest[];
    operationResults: AgentResumeControlledOperationResult[];
    readbackResults: AgentResumeControlledReadbackResult[];
    dryRun: boolean;
    blockers: string[];
    warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const output: string[] = [];
    for (const item of value) {
        const text = String(item || '').trim();
        if (!text || output.includes(text)) continue;
        output.push(text);
    }
    return output;
}

function normalizeRunnerTarget(input: AgentResumeControlledExecutionRunnerInput): AgentResumeControlledExecutionRunnerTarget {
    if (input.executionTarget === 'fake-adapter') return 'fake-adapter';
    if (input.executionTarget === 'live-photoshop') return 'live-photoshop';
    return 'dry-run';
}

function normalizeAdapterResult(value: AgentResumeControlledAdapterResult | unknown): {
    success: boolean;
    error?: string;
    data?: unknown;
} {
    if (!isRecord(value)) {
        return {
            success: true,
            data: sanitizeAgentResumePlanningValue(value)
        };
    }

    const hasExplicitSuccess = Object.prototype.hasOwnProperty.call(value, 'success');
    const error = typeof value.error === 'string' ? value.error : undefined;
    return {
        success: hasExplicitSuccess ? value.success === true : !error,
        error,
        data: sanitizeAgentResumePlanningValue(value.data)
    };
}

function runFakeAdapterWriteOperation(
    adapter: AgentResumeControlledExecutionAdapter,
    operation: AgentResumeControlledOperationRequest
): AgentResumeControlledOperationResult {
    let result: ReturnType<AgentResumeControlledExecutionAdapter['runWriteOperation']>;
    try {
        result = adapter.runWriteOperation(operation);
    } catch (error) {
        result = {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }

    const normalized = normalizeAdapterResult(result);
    return {
        operationId: operation.operationId,
        toolName: operation.toolName,
        success: normalized.success,
        error: normalized.error,
        data: normalized.data
    };
}

function hasExecutableOperationParams(operation: AgentResumeControlledOperationRequest): boolean {
    return Object.prototype.hasOwnProperty.call(operation, 'params')
        && operation.params !== undefined
        && operation.params !== null;
}

function findOperationsMissingParams(
    request: AgentResumeControlledExecutionRequest
): AgentResumeControlledOperationRequest[] {
    return request.operationRequests.filter((operation) => !hasExecutableOperationParams(operation));
}

function runFakeAdapterReadback(
    adapter: AgentResumeControlledExecutionAdapter,
    operation: AgentResumeControlledOperationRequest,
    target: string
): AgentResumeControlledReadbackResult {
    let result: ReturnType<NonNullable<AgentResumeControlledExecutionAdapter['readbackAfterOperation']>>;
    try {
        result = adapter.readbackAfterOperation
            ? adapter.readbackAfterOperation(operation, target)
            : {
                success: false,
                error: 'readback_adapter_missing'
            };
    } catch (error) {
        result = {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }

    const normalized = normalizeAdapterResult(result);
    return {
        operationId: operation.operationId,
        toolName: operation.toolName,
        target,
        success: normalized.success,
        error: normalized.error,
        data: normalized.data
    };
}

function buildOperationRequests(
    executionGate?: AgentResumeExecutionGate
): AgentResumeControlledOperationRequest[] {
    if (!executionGate) return [];

    const readbackTargets = [...executionGate.readbackTargets];
    const plan = executionGate.executionPlan;
    const steps = isRecord(plan) && Array.isArray(plan.steps) ? plan.steps : [];
    const operations: AgentResumeControlledOperationRequest[] = [];

    for (const [index, step] of steps.entries()) {
        if (!isRecord(step)) continue;
        const toolName = String(step.toolName || step.tool || '').trim();
        if (!toolName || !executionGate.proposedWriteTools.includes(toolName)) continue;
        operations.push({
            operationId: `resume-op-${index + 1}`,
            toolName,
            params: sanitizeAgentResumePlanningValue(step.params),
            paramsSummary: typeof step.paramsSummary === 'string' ? step.paramsSummary : undefined,
            readbackTargets
        });
    }

    if (operations.length > 0) return operations;

    return executionGate.proposedWriteTools.map((toolName, index) => ({
        operationId: `resume-op-${index + 1}`,
        toolName,
        readbackTargets
    }));
}

function buildRequest(input: {
    executionGate?: AgentResumeExecutionGate;
    status: AgentResumeControlledExecutionRequestStatus;
    requestId?: string;
    canStartControlledRunner?: boolean;
    blockers?: string[];
    warnings?: string[];
}): AgentResumeControlledExecutionRequest {
    const executionGate = input.executionGate;
    return {
        version: 'agent-resume-controlled-execution-request/v0',
        status: input.status,
        requestId: input.requestId,
        executionGateStatus: executionGate?.status,
        writesPerformed: false,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: false,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiresControlledRunner: true,
        requiresReadbackAfterEachWrite: true,
        canStartControlledRunner: input.canStartControlledRunner === true,
        approvedWriteTools: executionGate?.proposedWriteTools || [],
        readbackTargets: executionGate?.readbackTargets || [],
        operationRequests: buildOperationRequests(executionGate),
        executionPlan: sanitizeAgentResumePlanningValue(executionGate?.executionPlan),
        blockers: input.blockers || [],
        warnings: input.warnings || []
    };
}

export function buildAgentResumeControlledExecutionRequest(
    input: AgentResumeControlledExecutionRequestInput
): AgentResumeControlledExecutionRequest {
    const executionGate = input.executionGate;
    const requestId = input.requestId || 'resume-controlled-execution-request';

    if (!executionGate) {
        return buildRequest({
            status: 'not_applicable',
            requestId,
            blockers: ['缺少恢复执行 gate，不能创建受控恢复执行请求包。']
        });
    }

    if (executionGate.status !== 'ready_for_approved_execution' || executionGate.canDispatchWriteTools !== true) {
        return buildRequest({
            executionGate,
            status: 'blocked_execution_gate_not_ready',
            requestId,
            blockers: [
                ...executionGate.blockers,
                '恢复执行 gate 尚未通过，不能创建受控恢复执行请求包。'
            ],
            warnings: executionGate.warnings
        });
    }

    if (input.enableControlledExecutionRequest !== true) {
        return buildRequest({
            executionGate,
            status: 'blocked_execution_disabled',
            requestId,
            blockers: ['受控恢复执行请求包默认关闭，需要显式启用后才可交给 runner。'],
            warnings: [
                ...executionGate.warnings,
                'AGENT-168 只建立请求包接口，默认仍不允许写 Photoshop。'
            ]
        });
    }

    return buildRequest({
        executionGate,
        status: 'ready_for_controlled_runner',
        requestId,
        canStartControlledRunner: true,
        warnings: [
            ...executionGate.warnings,
            '请求包已准备好交给受控 runner；请求包本身不写 Photoshop。'
        ]
    });
}

function resolveExecutionState(
    status: AgentResumeControlledExecutionRunnerStatus
): AgentResumeControlledExecutionState {
    if (status === 'completed_dry_run') return 'dry_run';
    if (status === 'completed_fake_adapter_verified' || status === 'completed_live_adapter_verified') {
        return 'completed';
    }
    if (status === 'failed_write_operation' || status === 'failed_readback') return 'failed';
    return 'not_started';
}

function resolveVerificationStatus(
    status: AgentResumeControlledExecutionRunnerStatus,
    readbackResults: AgentResumeControlledReadbackResult[]
): AgentResumeControlledVerificationStatus {
    if (status === 'failed_readback') return 'failed';
    if ((status === 'completed_fake_adapter_verified' || status === 'completed_live_adapter_verified')
        && readbackResults.length > 0
        && readbackResults.every((result) => result.success)) {
        return 'passed';
    }
    return 'not_run';
}

function buildRun(input: {
    request?: AgentResumeControlledExecutionRequest;
    status: AgentResumeControlledExecutionRunnerStatus;
    executionTarget?: AgentResumeControlledExecutionRunnerTarget;
    dryRun?: boolean;
    mustNotRunWriteTools?: boolean;
    shouldRunPhotoshop?: boolean;
    operationResults?: AgentResumeControlledOperationResult[];
    readbackResults?: AgentResumeControlledReadbackResult[];
    blockers?: string[];
    warnings?: string[];
}): AgentResumeControlledExecutionRun {
    const request = input.request;
    const plannedWriteTools = request
        ? normalizeStringList(request.operationRequests.map((operation) => operation.toolName))
        : [];
    const operationResults = input.operationResults || [];
    const readbackResults = input.readbackResults || [];
    const executionTarget = input.executionTarget || 'dry-run';
    const executionState = resolveExecutionState(input.status);
    const verificationStatus = resolveVerificationStatus(input.status, readbackResults);
    const successfulWriteTools = normalizeStringList(
        operationResults
            .filter((result) => result.success)
            .map((result) => result.toolName)
    );

    return {
        version: 'agent-resume-controlled-execution-runner/v0',
        status: input.status,
        requestId: request?.requestId,
        requestStatus: request?.status,
        executionTarget,
        fakeAdapterOnly: executionTarget === 'fake-adapter',
        executionState,
        verificationStatus,
        writesPerformed: executionTarget === 'live-photoshop' && successfulWriteTools.length > 0,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: input.shouldRunPhotoshop === true,
        mustNotRunWriteTools: input.mustNotRunWriteTools !== false,
        mustNotClaimTaskCompletion: true,
        plannedWriteTools,
        executedWriteTools: successfulWriteTools,
        readbackTargets: request?.readbackTargets || [],
        operationRequests: request?.operationRequests || [],
        operationResults,
        readbackResults,
        dryRun: input.dryRun === true,
        blockers: input.blockers || [],
        warnings: input.warnings || []
    };
}

function runAdapterOperationSequence(input: {
    request: AgentResumeControlledExecutionRequest;
    adapter: AgentResumeControlledExecutionAdapter;
    executionTarget: AgentResumeControlledExecutionRunnerTarget;
    completedStatus: AgentResumeControlledExecutionRunnerStatus;
    shouldRunPhotoshop?: boolean;
    mustNotRunWriteTools?: boolean;
}): AgentResumeControlledExecutionRun {
    const request = input.request;
    const adapter = input.adapter;

    if (request.readbackTargets.length > 0 && typeof adapter.readbackAfterOperation !== 'function') {
        return buildRun({
            request,
            executionTarget: input.executionTarget,
            status: 'blocked_readback_adapter_required',
            blockers: ['受控执行要求每次写入后读回；adapter 缺少 readbackAfterOperation。'],
            warnings: request.warnings
        });
    }

    const operationResults: AgentResumeControlledOperationResult[] = [];
    const readbackResults: AgentResumeControlledReadbackResult[] = [];

    for (const operation of request.operationRequests) {
        const operationResult = runFakeAdapterWriteOperation(adapter, operation);
        operationResults.push(operationResult);
        if (!operationResult.success) {
            return buildRun({
                request,
                executionTarget: input.executionTarget,
                status: 'failed_write_operation',
                shouldRunPhotoshop: input.shouldRunPhotoshop,
                mustNotRunWriteTools: input.mustNotRunWriteTools,
                operationResults,
                readbackResults,
                blockers: [`写入操作 ${operation.toolName} 失败：${operationResult.error || 'unknown error'}`],
                warnings: request.warnings
            });
        }

        const targets = operation.readbackTargets.length > 0 ? operation.readbackTargets : request.readbackTargets;
        for (const target of targets) {
            const readbackResult = runFakeAdapterReadback(adapter, operation, target);
            readbackResults.push(readbackResult);
            if (!readbackResult.success) {
                return buildRun({
                    request,
                    executionTarget: input.executionTarget,
                    status: 'failed_readback',
                    shouldRunPhotoshop: input.shouldRunPhotoshop,
                    mustNotRunWriteTools: input.mustNotRunWriteTools,
                    operationResults,
                    readbackResults,
                    blockers: [`写入后读回 ${target} 失败：${readbackResult.error || 'unknown error'}`],
                    warnings: request.warnings
                });
            }
        }
    }

    return buildRun({
        request,
        executionTarget: input.executionTarget,
        status: input.completedStatus,
        shouldRunPhotoshop: input.shouldRunPhotoshop,
        mustNotRunWriteTools: input.mustNotRunWriteTools,
        operationResults,
        readbackResults,
        warnings: request.warnings
    });
}

export function runAgentResumeControlledExecutionRunner(
    input: AgentResumeControlledExecutionRunnerInput
): AgentResumeControlledExecutionRun {
    const request = input.request;
    const executionTarget = normalizeRunnerTarget(input);

    if (!request) {
        return buildRun({
            executionTarget,
            status: 'not_applicable',
            blockers: ['缺少受控恢复执行请求包，runner 不能运行。']
        });
    }

    if (request.status !== 'ready_for_controlled_runner' || request.canStartControlledRunner !== true) {
        return buildRun({
            request,
            executionTarget,
            status: 'blocked_request_not_ready',
            blockers: [
                ...request.blockers,
                '受控恢复执行请求包尚未 ready，runner 不能运行。'
            ],
            warnings: request.warnings
        });
    }

    if (executionTarget === 'live-photoshop') {
        if (input.allowPhotoshopWrites !== true) {
            return buildRun({
                request,
                executionTarget,
                status: 'blocked_live_write_permission_missing',
                blockers: ['live Photoshop runner 需要显式 allowPhotoshopWrites=true，不能由 target 名称自动放行。'],
                warnings: [
                    ...request.warnings,
                    '缺少 live 写入显式授权时，不调用 Photoshop 写工具。'
                ]
            });
        }

        const adapter = input.adapter;
        if (!adapter || typeof adapter.runWriteOperation !== 'function') {
            return buildRun({
                request,
                executionTarget,
                status: 'blocked_live_adapter_required',
                blockers: ['live Photoshop runner 需要注入受控 live adapter，不能从共享契约直接调用 Photoshop。'],
                warnings: [
                    ...request.warnings,
                    'live runner 只执行显式注入的 adapter，不从确认按钮或模型输出直接写 Photoshop。'
                ]
            });
        }

        const operationsMissingParams = findOperationsMissingParams(request);
        if (operationsMissingParams.length > 0) {
            return buildRun({
                request,
                executionTarget,
                status: 'blocked_live_operation_params_required',
                blockers: operationsMissingParams.map((operation) =>
                    `live 写入操作缺少可回放 params：${operation.operationId}/${operation.toolName}`
                ),
                warnings: [
                    ...request.warnings,
                    'paramsSummary 只能用于展示，不能被 live runner 推断成 Photoshop 写入参数。'
                ]
            });
        }

        return runAdapterOperationSequence({
            request,
            adapter,
            executionTarget,
            completedStatus: 'completed_live_adapter_verified',
            shouldRunPhotoshop: true,
            mustNotRunWriteTools: false
        });
    }

    if (executionTarget === 'fake-adapter') {
        const adapter = input.adapter;
        if (!adapter || typeof adapter.runWriteOperation !== 'function') {
            return buildRun({
                request,
                executionTarget,
                status: 'blocked_adapter_required',
                blockers: ['fake adapter runner 需要注入 runWriteOperation，不能回退为真实 Photoshop 写入。'],
                warnings: [
                    ...request.warnings,
                    'AGENT-169 fake runner 只允许显式注入 adapter，不会自动调用 Photoshop 写工具。'
                ]
            });
        }

        if (request.readbackTargets.length > 0 && typeof adapter.readbackAfterOperation !== 'function') {
            return buildRun({
                request,
                executionTarget,
                status: 'blocked_readback_adapter_required',
                blockers: ['受控恢复执行要求每次写入后读回；fake adapter 缺少 readbackAfterOperation。'],
                warnings: request.warnings
            });
        }

        const operationResults: AgentResumeControlledOperationResult[] = [];
        const readbackResults: AgentResumeControlledReadbackResult[] = [];

        for (const operation of request.operationRequests) {
            const operationResult = runFakeAdapterWriteOperation(adapter, operation);
            operationResults.push(operationResult);

            if (!operationResult.success) {
                return buildRun({
                    request,
                    executionTarget,
                    status: 'failed_write_operation',
                    operationResults,
                    readbackResults,
                    blockers: [`fake_adapter_write_operation_failed:${operation.operationId}`],
                    warnings: request.warnings
                });
            }

            const targets = operation.readbackTargets.length > 0 ? operation.readbackTargets : request.readbackTargets;
            for (const target of targets) {
                const readbackResult = runFakeAdapterReadback(adapter, operation, target);
                readbackResults.push(readbackResult);
                if (!readbackResult.success) {
                    return buildRun({
                        request,
                        executionTarget,
                        status: 'failed_readback',
                        operationResults,
                        readbackResults,
                        blockers: [`fake_adapter_readback_failed:${operation.operationId}:${target}`],
                        warnings: request.warnings
                    });
                }
            }
        }

        return buildRun({
            request,
            executionTarget,
            status: 'completed_fake_adapter_verified',
            operationResults,
            readbackResults,
            warnings: [
                ...request.warnings,
                'fake adapter runner 已按请求包执行并完成逐步读回；这不是 Photoshop live 写入，也不证明任务完成。'
            ]
        });
    }

    return buildRun({
        request,
        executionTarget,
        status: 'completed_dry_run',
        dryRun: true,
        warnings: [
            ...request.warnings,
            'runner 默认只生成 dry-run 执行预览，不调用 Photoshop 写工具。'
        ]
    });
}
