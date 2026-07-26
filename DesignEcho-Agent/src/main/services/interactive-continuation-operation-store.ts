import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
    buildClaimedInteractiveContinuationOperationRecord,
    buildInteractiveContinuationEnvelopeFingerprint,
    isInteractiveContinuationOperationRecord,
    isSameInteractiveContinuationOperationIdentity,
    markInteractiveContinuationOperationRunning,
    markInteractiveContinuationOperationUnknown,
    normalizeInteractiveContinuationOperationIdentity,
    settleInteractiveContinuationOperationRecord,
    validateInteractiveContinuationOperationClaim,
    validateInteractiveContinuationOperationIdentity,
    type InteractiveContinuationOperationActionResult,
    type InteractiveContinuationOperationBeginInput,
    type InteractiveContinuationOperationClaimInput,
    type InteractiveContinuationOperationIdentity,
    type InteractiveContinuationMutationState,
    type InteractiveContinuationOperationRecord,
    type InteractiveContinuationOperationSettleInput
} from '../../shared/interactive-continuation-operation';
import { serializedFileOperations } from './serialized-file-operations';

interface StoredRecordReadResult {
    status: 'absent' | 'found' | 'invalid';
    record?: InteractiveContinuationOperationRecord;
    error?: string;
}

function nowIso(): string {
    return new Date().toISOString();
}

function operationError(code: string, message: string): InteractiveContinuationOperationActionResult {
    return { success: false, code, message };
}

function runningOwnerConflict(
    record: InteractiveContinuationOperationRecord
): InteractiveContinuationOperationActionResult {
    return {
        ...operationError(
            'interactive_continuation_operation_owned_by_other_renderer',
            '这张确认卡对应的操作正由另一个渲染进程执行，未修改其状态，也不会并发写入。'
        ),
        record
    };
}

function terminalOperationError(
    record: InteractiveContinuationOperationRecord
): InteractiveContinuationOperationActionResult {
    if (record.status === 'succeeded') {
        return operationError(
            'interactive_continuation_operation_already_succeeded',
            '这张确认卡对应的操作已经完成，不会重复写入 Photoshop。'
        );
    }
    if (record.status === 'failed') {
        return operationError(
            'interactive_continuation_operation_already_failed',
            '这张确认卡对应的操作已经终止，并确认没有写入 Photoshop；请根据原提示修正后重新发起任务。'
        );
    }
    if (record.status === 'unknown') {
        return operationError(
            'interactive_continuation_operation_unknown',
            '上次执行在中断后处于不确定状态。请先检查 Photoshop 当前画面，再重新发起任务；系统不会自动重放。'
        );
    }
    return operationError(
        'interactive_continuation_operation_invalid_state',
        `交互操作处于不可执行状态：${record.status}。`
    );
}

export class InteractiveContinuationOperationStore {
    private readonly hostSessionId: string;

    constructor(
        private readonly rootDir: string,
        hostSessionId?: string
    ) {
        this.hostSessionId = String(hostSessionId || randomUUID()).trim();
    }

    getHostSessionId(): string {
        return this.hostSessionId;
    }

    async claim(
        input: InteractiveContinuationOperationClaimInput
    ): Promise<InteractiveContinuationOperationActionResult> {
        const validationIssue = validateInteractiveContinuationOperationClaim(input);
        if (validationIssue) {
            return operationError(
                'interactive_continuation_operation_invalid_claim',
                `确认操作没有进入执行账本：${validationIssue}`
            );
        }
        const identity = normalizeInteractiveContinuationOperationIdentity(input);
        return await this.runExclusive(identity.continuationId, async (filePath) => {
            const existing = await this.readRecord(filePath);
            if (existing.status === 'invalid') {
                return operationError(
                    'interactive_continuation_operation_corrupt',
                    `确认操作账本损坏，本轮不会执行：${existing.error || '记录格式无效。'}`
                );
            }
            if (existing.status === 'absent') {
                const record = buildClaimedInteractiveContinuationOperationRecord({
                    claim: input,
                    now: nowIso()
                });
                await this.writeRecord(filePath, record);
                return {
                    success: true,
                    code: 'interactive_continuation_operation_claimed',
                    message: '确认操作已进入持久化执行账本。',
                    record
                };
            }

            const record = existing.record!;
            if (!isSameInteractiveContinuationOperationIdentity(record, identity)) {
                return operationError(
                    'interactive_continuation_operation_conflict',
                    '同一个 continuation 已绑定另一份确认内容，本轮不会覆盖或执行。'
                );
            }
            const incomingContinuationFingerprint = buildInteractiveContinuationEnvelopeFingerprint(input.continuation);
            if (record.continuationFingerprint !== incomingContinuationFingerprint) {
                return operationError(
                    'interactive_continuation_operation_envelope_conflict',
                    '同一个 continuation 已绑定另一份执行参数，本轮不会覆盖或执行。'
                );
            }
            if (record.status === 'claimed') {
                return {
                    success: true,
                    code: 'interactive_continuation_operation_claim_idempotent',
                    message: '确认操作已经登记，将继续承接原操作。',
                    record,
                    idempotent: true
                };
            }
            if (record.status === 'running') {
                return await this.rejectOrRecoverRunning(filePath, record);
            }
            return terminalOperationError(record);
        });
    }

    async begin(
        input: InteractiveContinuationOperationBeginInput,
        rendererOwnerId: string
    ): Promise<InteractiveContinuationOperationActionResult> {
        const validationIssue = validateInteractiveContinuationOperationIdentity(input);
        if (validationIssue) {
            return operationError(
                'interactive_continuation_operation_invalid_begin',
                `确认操作无法开始：${validationIssue}`
            );
        }
        const identity = normalizeInteractiveContinuationOperationIdentity(input);
        const normalizedRendererOwnerId = String(rendererOwnerId || '').trim();
        if (!normalizedRendererOwnerId) {
            return operationError(
                'interactive_continuation_operation_missing_renderer_owner',
                '无法确认本次执行属于哪个渲染进程，本轮不会执行。'
            );
        }
        const normalizedExecutionRunId = String(input.executionRunId || '').trim();
        if (!normalizedExecutionRunId) {
            return operationError(
                'interactive_continuation_operation_missing_execution_run',
                '确认操作缺少本次执行令牌，本轮不会执行。'
            );
        }
        return await this.runExclusive(identity.continuationId, async (filePath) => {
            const existing = await this.readRecord(filePath);
            if (existing.status === 'invalid') {
                return operationError(
                    'interactive_continuation_operation_corrupt',
                    `确认操作账本损坏，本轮不会执行：${existing.error || '记录格式无效。'}`
                );
            }
            if (existing.status === 'absent') {
                return operationError(
                    'interactive_continuation_operation_not_claimed',
                    '确认操作还没有进入持久化账本，本轮不会执行。'
                );
            }
            const record = existing.record!;
            if (!isSameInteractiveContinuationOperationIdentity(record, identity)) {
                return operationError(
                    'interactive_continuation_operation_conflict',
                    '确认操作与持久化账本不一致，本轮不会执行。'
                );
            }
            if (record.status === 'claimed') {
                const running = markInteractiveContinuationOperationRunning({
                    record,
                    hostSessionId: this.hostSessionId,
                    rendererOwnerId: normalizedRendererOwnerId,
                    executionRunId: normalizedExecutionRunId,
                    now: nowIso()
                });
                await this.writeRecord(filePath, running);
                return {
                    success: true,
                    code: 'interactive_continuation_operation_running',
                    message: '确认操作已取得唯一执行权。',
                    record: running
                };
            }
            if (record.status === 'running') {
                return await this.rejectOrRecoverRunning(filePath, record, normalizedRendererOwnerId);
            }
            return terminalOperationError(record);
        });
    }

    async settle(
        input: InteractiveContinuationOperationSettleInput,
        rendererOwnerId: string
    ): Promise<InteractiveContinuationOperationActionResult> {
        if (input?.status !== 'succeeded' && input?.status !== 'failed') {
            return operationError(
                'interactive_continuation_operation_invalid_settlement_status',
                '确认操作结算状态无效，未修改持久化操作状态。'
            );
        }
        const validationIssue = validateInteractiveContinuationOperationIdentity(input);
        if (validationIssue) {
            return operationError(
                'interactive_continuation_operation_invalid_settlement',
                `确认操作无法结算：${validationIssue}`
            );
        }
        const identity = normalizeInteractiveContinuationOperationIdentity(input);
        return await this.runExclusive(identity.continuationId, async (filePath) => {
            const existing = await this.readRecord(filePath);
            if (existing.status === 'invalid') {
                return operationError(
                    'interactive_continuation_operation_corrupt',
                    `确认操作账本损坏，无法结算：${existing.error || '记录格式无效。'}`
                );
            }
            if (existing.status === 'absent') {
                return operationError(
                    'interactive_continuation_operation_not_claimed',
                    '确认操作没有持久化记录，无法声明执行完成。'
                );
            }
            const record = existing.record!;
            if (!isSameInteractiveContinuationOperationIdentity(record, identity)) {
                return operationError(
                    'interactive_continuation_operation_conflict',
                    '确认操作与持久化账本不一致，无法声明执行完成。'
                );
            }
            if (record.status === input.status) {
                return {
                    success: true,
                    code: 'interactive_continuation_operation_settlement_idempotent',
                    message: '确认操作已经完成同一结算。',
                    record,
                    idempotent: true
                };
            }
            if (record.status === 'claimed' && input.status === 'failed') {
                const settled = settleInteractiveContinuationOperationRecord({
                    record,
                    status: 'failed',
                    mutationState: 'none',
                    summary: input.summary,
                    now: nowIso()
                });
                await this.writeRecord(filePath, settled);
                return {
                    success: true,
                    code: 'interactive_continuation_operation_failed_before_execution',
                    message: '确认操作在执行前校验失败，已终止且没有写入 Photoshop。',
                    record: settled
                };
            }
            if (record.status !== 'running') {
                return terminalOperationError(record);
            }
            if (record.runningHostSessionId !== this.hostSessionId) {
                return await this.markStaleRunningUnknown(filePath, record);
            }
            const normalizedRendererOwnerId = String(rendererOwnerId || '').trim();
            if (record.runningRendererOwnerId !== normalizedRendererOwnerId) {
                return runningOwnerConflict(record);
            }
            const normalizedExecutionRunId = String(input.executionRunId || '').trim();
            if (!normalizedExecutionRunId || record.runningExecutionRunId !== normalizedExecutionRunId) {
                return {
                    ...operationError(
                        'interactive_continuation_operation_execution_run_mismatch',
                        '本次结算不属于取得执行权的 Agent 运行，未修改操作状态。'
                    ),
                    record
                };
            }
            if (input.status === 'failed') {
                const mutationState = normalizeMutationState(input.mutationState);
                if (mutationState === 'none') {
                    const settled = settleInteractiveContinuationOperationRecord({
                        record,
                        status: 'failed',
                        mutationState,
                        summary: input.summary,
                        now: nowIso()
                    });
                    await this.writeRecord(filePath, settled);
                    return {
                        success: true,
                        code: 'interactive_continuation_operation_failed_without_mutation',
                        message: '确认操作执行失败，但运行结果确认没有产生 Photoshop 修改。',
                        record: settled
                    };
                }
                const unknown = markInteractiveContinuationOperationUnknown({
                    record,
                    mutationState,
                    reason: buildFailedMutationUncertaintyReason(mutationState, input.summary),
                    now: nowIso()
                });
                await this.writeRecord(filePath, unknown);
                return {
                    success: true,
                    code: 'interactive_continuation_operation_unknown_after_execution_failure',
                    message: mutationState === 'observed'
                        ? '执行失败前已经观察到画面或文件修改，当前结果已标记为不确定；请先检查 Photoshop，系统不会自动重放。'
                        : '执行结果缺少可靠的修改统计，无法排除 Photoshop 已发生写入；请先检查当前画面，系统不会自动重放。',
                    record: unknown
                };
            }
            const settled = settleInteractiveContinuationOperationRecord({
                record,
                status: 'succeeded',
                mutationState: normalizeMutationState(input.mutationState),
                summary: input.summary,
                now: nowIso()
            });
            await this.writeRecord(filePath, settled);
            return {
                success: true,
                code: 'interactive_continuation_operation_succeeded',
                message: '确认操作已完成并结算。',
                record: settled
            };
        });
    }

    async get(
        continuationId: string,
        rendererOwnerId?: string
    ): Promise<InteractiveContinuationOperationActionResult> {
        const normalizedId = String(continuationId || '').trim();
        if (!normalizedId) {
            return operationError(
                'interactive_continuation_operation_missing_id',
                '缺少 continuationId。'
            );
        }
        return await this.runExclusive(normalizedId, async (filePath) => {
            const existing = await this.readRecord(filePath);
            if (existing.status === 'invalid') {
                return operationError(
                    'interactive_continuation_operation_corrupt',
                    `确认操作账本损坏：${existing.error || '记录格式无效。'}`
                );
            }
            if (existing.status === 'absent') {
                return operationError(
                    'interactive_continuation_operation_not_found',
                    '没有找到这笔确认操作。'
                );
            }
            const record = existing.record!;
            if (record.status === 'running') {
                if (record.runningHostSessionId !== this.hostSessionId) {
                    return await this.markStaleRunningUnknown(filePath, record);
                }
                const normalizedRendererOwnerId = String(rendererOwnerId || '').trim();
                if (normalizedRendererOwnerId && record.runningRendererOwnerId !== normalizedRendererOwnerId) {
                    return runningOwnerConflict(record);
                }
            }
            return {
                success: true,
                code: 'interactive_continuation_operation_found',
                message: `确认操作状态：${record.status}。`,
                record
            };
        });
    }

    async markRunningUnknownIfOwned(input: {
        continuationId: string;
        rendererOwnerId: string;
        reason: string;
    }): Promise<InteractiveContinuationOperationActionResult> {
        const continuationId = String(input.continuationId || '').trim();
        const rendererOwnerId = String(input.rendererOwnerId || '').trim();
        if (!continuationId || !rendererOwnerId) {
            return operationError(
                'interactive_continuation_operation_missing_owner',
                '缺少运行操作或渲染进程标识。'
            );
        }
        return await this.runExclusive(continuationId, async (filePath) => {
            const existing = await this.readRecord(filePath);
            if (existing.status !== 'found') {
                return operationError(
                    'interactive_continuation_operation_not_found',
                    '没有找到需要标记为不确定的运行操作。'
                );
            }
            const record = existing.record!;
            if (record.status === 'unknown') {
                return {
                    success: true,
                    code: 'interactive_continuation_operation_unknown_idempotent',
                    message: '确认操作已经处于不确定状态。',
                    record,
                    idempotent: true
                };
            }
            if (record.status !== 'running' || record.runningRendererOwnerId !== rendererOwnerId) {
                return operationError(
                    'interactive_continuation_operation_owner_mismatch',
                    '运行操作不属于当前渲染进程，未修改其状态。'
                );
            }
            const marked = await this.markStaleRunningUnknown(filePath, record, input.reason);
            return {
                success: true,
                code: 'interactive_continuation_operation_marked_unknown',
                message: marked.message,
                record: marked.record
            };
        });
    }

    private async rejectOrRecoverRunning(
        filePath: string,
        record: InteractiveContinuationOperationRecord,
        rendererOwnerId?: string
    ): Promise<InteractiveContinuationOperationActionResult> {
        if (record.runningHostSessionId !== this.hostSessionId) {
            return await this.markStaleRunningUnknown(filePath, record);
        }
        const normalizedRendererOwnerId = String(rendererOwnerId || '').trim();
        if (normalizedRendererOwnerId && record.runningRendererOwnerId !== normalizedRendererOwnerId) {
            return runningOwnerConflict(record);
        }
        return operationError(
            'interactive_continuation_operation_already_running',
            '这张确认卡对应的操作正在执行，不会并发或重复写入。'
        );
    }

    private async markStaleRunningUnknown(
        filePath: string,
        record: InteractiveContinuationOperationRecord,
        reason?: string
    ): Promise<InteractiveContinuationOperationActionResult> {
        const unknown = markInteractiveContinuationOperationUnknown({
            record,
            reason: reason || '执行所属的 Electron 主进程或渲染进程已经变化，无法判断中断前 Photoshop 是否完成写入。',
            now: nowIso()
        });
        await this.writeRecord(filePath, unknown);
        return {
            ...terminalOperationError(unknown),
            record: unknown
        };
    }

    private async runExclusive<T>(
        continuationId: string,
        operation: (filePath: string) => Promise<T>
    ): Promise<T> {
        const filePath = this.resolveFilePath(continuationId);
        return await serializedFileOperations.runExclusive(filePath, operation);
    }

    private resolveFilePath(continuationId: string): string {
        const digest = createHash('sha256').update(continuationId, 'utf8').digest('hex');
        return path.join(this.rootDir, `${digest}.json`);
    }

    private async readRecord(filePath: string): Promise<StoredRecordReadResult> {
        let content: string;
        try {
            content = await fs.promises.readFile(filePath, 'utf8');
        } catch (error: any) {
            if (error?.code === 'ENOENT') return { status: 'absent' };
            return { status: 'invalid', error: error?.message || String(error) };
        }
        try {
            const parsed = JSON.parse(content);
            if (!isInteractiveContinuationOperationRecord(parsed)) {
                return { status: 'invalid', error: '记录未通过 interactive-continuation-operation/v0 校验。' };
            }
            return { status: 'found', record: parsed };
        } catch (error: any) {
            return { status: 'invalid', error: error?.message || String(error) };
        }
    }

    private async writeRecord(
        filePath: string,
        record: InteractiveContinuationOperationRecord
    ): Promise<void> {
        await serializedFileOperations.writeUtf8Atomically(
            filePath,
            `${JSON.stringify(record, null, 2)}\n`
        );
    }
}

function normalizeMutationState(value: unknown): InteractiveContinuationMutationState {
    if (value === 'none' || value === 'observed') return value;
    return 'unknown';
}

function buildFailedMutationUncertaintyReason(
    mutationState: Exclude<InteractiveContinuationMutationState, 'none'>,
    summary?: string
): string {
    const detail = String(summary || '').trim();
    if (mutationState === 'observed') {
        return detail
            ? `执行失败前已经观察到 Photoshop 修改：${detail}`
            : '执行失败前已经观察到 Photoshop 修改，无法确认当前画面是否为完整结果。';
    }
    return detail
        ? `执行失败且缺少可靠的修改统计，无法排除 Photoshop 已产生写入：${detail}`
        : '执行失败且缺少可靠的修改统计，无法排除 Photoshop 已产生写入。';
}
