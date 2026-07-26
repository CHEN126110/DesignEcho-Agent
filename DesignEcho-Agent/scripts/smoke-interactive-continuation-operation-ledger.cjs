#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
    buildInteractiveCardSubmissionFingerprint
} = require('../src/shared/interactive-card-contract.ts');
const {
    buildInteractiveContinuationRendererEnvelope,
    isInteractiveContinuationRendererEnvelope,
    resolveInteractiveContinuationMutationState
} = require('../src/shared/interactive-continuation-operation.ts');
const {
    InteractiveContinuationOperationStore
} = require('../src/main/services/interactive-continuation-operation-store.ts');
const {
    claimInteractiveContinuationOperation,
    getInteractiveContinuationOperation,
    markInteractiveContinuationOperationUnknown,
    settleInteractiveContinuationOperation
} = require('../src/renderer/services/interactive-continuation-operation-client.ts');

function buildSubmission(submittedAt) {
    const value = {
        groups: [{ size: 2, combos: [[1, 2], [2, 1]] }],
        generateSelfSelectNotes: false
    };
    return {
        version: 'interactive-card-submission/v0',
        cardId: 'sku-card-1',
        kind: 'sku_combo_editor',
        submittedAt,
        value,
        validation: {
            valid: true,
            canSubmit: true,
            normalizedValue: value,
            issues: [],
            blockers: [],
            warnings: []
        }
    };
}

function buildClaim(continuationId, submittedAt) {
    const submission = buildSubmission(submittedAt);
    const continuation = {
        version: 'pending-interactive-continuation/v0',
        id: continuationId,
        createdAt: '2026-07-16T09:00:00.000Z',
        sourceTask: '帮我做 SKU',
        scope: {
            conversationId: 'conversation-1',
            projectId: 'project-1',
            projectPath: 'C:\\Projects\\SKU'
        },
        operation: {
            kind: 'skill_execution',
            skillId: 'sku-batch',
            params: { countPerSize: 5 }
        },
        card: {
            version: 'interactive-card/v0',
            id: submission.cardId,
            kind: submission.kind,
            title: '确认 SKU 组合',
            payload: { version: 'sku-combo-editor/v0' }
        },
        oneTime: true
    };
    return {
        continuationId,
        sourceMessageId: 'message-1',
        cardId: submission.cardId,
        submissionFingerprint: buildInteractiveCardSubmissionFingerprint(submission),
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'C:\\Projects\\SKU',
        submission,
        continuation,
        sourceCard: continuation.card
    };
}

async function runRendererLifecycleHandlerAssertions(rootDir) {
    const handlers = new Map();
    const fakeIpcMain = {
        handle(channel, handler) {
            handlers.set(channel, handler);
        }
    };
    const fakeApp = {
        getPath(name) {
            assert.strictEqual(name, 'userData');
            return rootDir;
        }
    };
    const originalLoad = Module._load;
    Module._load = function loadWithFakeElectron(request, parent, isMain) {
        if (request === 'electron') {
            return {
                app: fakeApp,
                ipcMain: fakeIpcMain
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let registerInteractiveContinuationOperationHandlers;
    try {
        ({
            registerInteractiveContinuationOperationHandlers
        } = require('../src/main/ipc-handlers/interactive-continuation-operation-handlers.ts'));
    } finally {
        Module._load = originalLoad;
    }
    registerInteractiveContinuationOperationHandlers();

    const claimHandler = handlers.get('interactiveContinuation:claim');
    const beginHandler = handlers.get('interactiveContinuation:begin');
    const settleHandler = handlers.get('interactiveContinuation:settle');
    const getHandler = handlers.get('interactiveContinuation:get');
    assert(claimHandler && beginHandler && settleHandler && getHandler);

    const sender = new EventEmitter();
    sender.id = 9101;
    sender.destroyed = false;
    sender.isDestroyed = function isDestroyed() {
        return this.destroyed;
    };
    const event = { sender };

    const oldGenerationId = 'renderer-generation-old';
    const oldClaim = buildClaim(
        'continuation-renderer-old',
        '2026-07-16T20:00:00.000Z'
    );
    assert.strictEqual((await claimHandler(event, oldClaim)).success, true);
    const oldBegin = await beginHandler(
        event,
        buildInteractiveContinuationRendererEnvelope(oldGenerationId, {
            ...oldClaim,
            executionRunId: 'run-renderer-old'
        })
    );
    assert.strictEqual(oldBegin.success, true);
    assert.strictEqual(oldBegin.record.status, 'running');

    sender.emit(
        'did-start-navigation',
        {},
        'app://designecho/reloaded',
        false,
        true
    );

    const currentGenerationId = 'renderer-generation-current';
    const currentClaim = buildClaim(
        'continuation-renderer-current',
        '2026-07-16T20:05:00.000Z'
    );
    assert.strictEqual((await claimHandler(event, currentClaim)).success, true);
    const currentBegin = await beginHandler(
        event,
        buildInteractiveContinuationRendererEnvelope(currentGenerationId, {
            ...currentClaim,
            executionRunId: 'run-renderer-current'
        })
    );
    assert.strictEqual(currentBegin.success, true);
    assert.strictEqual(currentBegin.record.status, 'running');

    const delayedOldRead = await getHandler(
        event,
        buildInteractiveContinuationRendererEnvelope(
            oldGenerationId,
            oldClaim.continuationId
        )
    );
    assert.strictEqual(delayedOldRead.success, false);
    assert.strictEqual(
        delayedOldRead.code,
        'interactive_continuation_operation_invalid_renderer_generation'
    );

    const currentAfterDelayedOldRead = await getHandler(
        event,
        buildInteractiveContinuationRendererEnvelope(
            currentGenerationId,
            currentClaim.continuationId
        )
    );
    assert.strictEqual(currentAfterDelayedOldRead.success, true);
    assert.strictEqual(
        currentAfterDelayedOldRead.record.status,
        'running',
        '旧页面迟到的 IPC 不得退休或污染当前页面正在执行的操作'
    );

    const unauthorizedGeneration = await getHandler(
        event,
        buildInteractiveContinuationRendererEnvelope(
            'renderer-generation-unexpected',
            currentClaim.continuationId
        )
    );
    assert.strictEqual(unauthorizedGeneration.success, false);
    assert.strictEqual(
        unauthorizedGeneration.code,
        'interactive_continuation_operation_invalid_renderer_generation'
    );
    const currentAfterUnauthorizedGeneration = await getHandler(
        event,
        buildInteractiveContinuationRendererEnvelope(
            currentGenerationId,
            currentClaim.continuationId
        )
    );
    assert.strictEqual(currentAfterUnauthorizedGeneration.success, true);
    assert.strictEqual(currentAfterUnauthorizedGeneration.record.status, 'running');

    const currentSettlement = await settleHandler(
        event,
        buildInteractiveContinuationRendererEnvelope(currentGenerationId, {
            ...currentClaim,
            status: 'succeeded',
            executionRunId: 'run-renderer-current',
            summary: '当前页面完成'
        })
    );
    assert.strictEqual(currentSettlement.success, true);
    assert.strictEqual(currentSettlement.record.status, 'succeeded');
}

async function main() {
    const rootDir = path.join(
        os.tmpdir(),
        `designecho-interactive-ledger-${process.pid}-${Date.now()}`
    );
    fs.mkdirSync(rootDir, { recursive: true });

    try {
        const rendererEnvelope = buildInteractiveContinuationRendererEnvelope(
            'renderer-generation-smoke',
            { continuationId: 'continuation-smoke' }
        );
        assert.strictEqual(isInteractiveContinuationRendererEnvelope(rendererEnvelope), true);
        assert.strictEqual(isInteractiveContinuationRendererEnvelope({
            ...rendererEnvelope,
            rendererGenerationId: 'short'
        }), false);
        assert.strictEqual(
            resolveInteractiveContinuationMutationState({
                executionSummary: { successfulMutationCalls: 0 }
            }),
            'none'
        );
        assert.strictEqual(
            resolveInteractiveContinuationMutationState({
                data: { executionSummary: { successfulMutationCalls: 2 } }
            }),
            'observed'
        );
        assert.strictEqual(
            resolveInteractiveContinuationMutationState({ success: false }),
            'unknown'
        );
        const unavailableClaim = await claimInteractiveContinuationOperation({});
        const unavailableGet = await getInteractiveContinuationOperation('continuation-unavailable');
        const unavailableMark = await markInteractiveContinuationOperationUnknown(
            'continuation-unavailable',
            'smoke'
        );
        const unavailableSettle = await settleInteractiveContinuationOperation({});
        assert(unavailableClaim.message.includes('本轮不会写入 Photoshop'));
        for (const result of [unavailableGet, unavailableMark, unavailableSettle]) {
            assert(!result.message.includes('本轮不会写入 Photoshop'));
            assert(result.message.includes('无法确认 Photoshop 是否已经产生写入'));
            assert(result.message.includes('系统不会自动重放'));
        }
        const engineSource = fs.readFileSync(
            path.join(__dirname, '..', 'src/renderer/services/design-agent/engine.ts'),
            'utf8'
        );
        assert(engineSource.includes('businessResultSucceeded: boolean'));
        assert(engineSource.includes('业务处理已经返回成功结果'));
        assert(engineSource.includes('业务处理已经返回失败结果'));

        const hostA = new InteractiveContinuationOperationStore(rootDir, 'host-a');
        const firstClaim = buildClaim('continuation-1', '2026-07-16T10:00:00.000Z');
        const claimed = await hostA.claim(firstClaim);
        assert.strictEqual(claimed.success, true);
        assert.strictEqual(claimed.record.status, 'claimed');

        for (const [continuationId, skillId] of [
            ['continuation-system-owner', 'autonomous-agent'],
            ['continuation-missing-owner', 'removed-skill-owner']
        ]) {
            const invalidOwnerClaim = buildClaim(continuationId, '2026-07-16T09:30:00.000Z');
            invalidOwnerClaim.continuation.operation.skillId = skillId;
            const invalidOwnerResult = await hostA.claim(invalidOwnerClaim);
            assert.strictEqual(invalidOwnerResult.success, false);
            assert.strictEqual(invalidOwnerResult.code, 'interactive_continuation_operation_invalid_claim');
        }

        const sourceCardConflict = buildClaim(
            'continuation-source-card-conflict',
            '2026-07-16T09:40:00.000Z'
        );
        sourceCardConflict.sourceCard = {
            ...sourceCardConflict.sourceCard,
            title: '同 ID 的另一张来源卡'
        };
        const sourceCardConflictResult = await hostA.claim(sourceCardConflict);
        assert.strictEqual(sourceCardConflictResult.success, false);
        assert.strictEqual(
            sourceCardConflictResult.code,
            'interactive_continuation_operation_invalid_claim'
        );

        const sameBusinessSubmissionLater = buildClaim(
            'continuation-1',
            '2026-07-16T10:05:00.000Z'
        );
        assert.strictEqual(
            firstClaim.submissionFingerprint,
            sameBusinessSubmissionLater.submissionFingerprint,
            '提交时间变化不能改变业务幂等指纹'
        );
        const idempotentClaim = await hostA.claim(sameBusinessSubmissionLater);
        assert.strictEqual(idempotentClaim.success, true);
        assert.strictEqual(idempotentClaim.idempotent, true);
        assert.strictEqual(
            idempotentClaim.record.submission.submittedAt,
            firstClaim.submission.submittedAt,
            '账本必须返回第一次登记的权威 submission'
        );

        const [beginA, beginB] = await Promise.all([
            hostA.begin({ ...firstClaim, executionRunId: 'run-1' }, 'renderer-a'),
            hostA.begin({ ...firstClaim, executionRunId: 'run-1' }, 'renderer-a')
        ]);
        const beginResults = [beginA, beginB];
        assert.strictEqual(beginResults.filter((result) => result.success).length, 1);
        assert.strictEqual(
            beginResults.filter((result) => result.code === 'interactive_continuation_operation_already_running').length,
            1,
            '并发 begin 必须只有一个执行者'
        );

        const settled = await hostA.settle({
            ...firstClaim,
            status: 'succeeded',
            executionRunId: 'run-1',
            summary: 'SKU 已生成'
        }, 'renderer-a');
        assert.strictEqual(settled.success, true);
        assert.strictEqual(settled.record.status, 'succeeded');

        const duplicateAfterSuccess = await hostA.claim(firstClaim);
        assert.strictEqual(duplicateAfterSuccess.success, false);
        assert.strictEqual(
            duplicateAfterSuccess.code,
            'interactive_continuation_operation_already_succeeded'
        );

        const secondClaim = buildClaim('continuation-2', '2026-07-16T11:00:00.000Z');
        assert.strictEqual((await hostA.claim(secondClaim)).success, true);
        assert.strictEqual((await hostA.begin({
            ...secondClaim,
            executionRunId: 'run-2'
        }, 'renderer-a')).success, true);

        const hostB = new InteractiveContinuationOperationStore(rootDir, 'host-b');
        const recovered = await hostB.get(secondClaim.continuationId, 'renderer-b');
        assert.strictEqual(recovered.success, false);
        assert.strictEqual(recovered.code, 'interactive_continuation_operation_unknown');
        assert.strictEqual(recovered.record.status, 'unknown');

        const replayAfterCrash = await hostB.begin({
            ...secondClaim,
            executionRunId: 'run-2-replay'
        }, 'renderer-b');
        assert.strictEqual(replayAfterCrash.success, false);
        assert.strictEqual(replayAfterCrash.code, 'interactive_continuation_operation_unknown');

        const tamperedClaim = buildClaim('continuation-3', '2026-07-16T12:00:00.000Z');
        tamperedClaim.submission.validation.normalizedValue.groups = [];
        const tampered = await hostA.claim(tamperedClaim);
        assert.strictEqual(tampered.success, false);
        assert.strictEqual(tampered.code, 'interactive_continuation_operation_invalid_claim');

        const rendererCrashClaim = buildClaim('continuation-4', '2026-07-16T13:00:00.000Z');
        assert.strictEqual((await hostA.claim(rendererCrashClaim)).success, true);
        assert.strictEqual((await hostA.begin({
            ...rendererCrashClaim,
            executionRunId: 'run-4'
        }, 'renderer-a')).success, true);
        const rendererCrash = await hostA.markRunningUnknownIfOwned({
            continuationId: rendererCrashClaim.continuationId,
            rendererOwnerId: 'renderer-a',
            reason: 'renderer process gone'
        });
        assert.strictEqual(rendererCrash.success, true);
        assert.strictEqual(rendererCrash.code, 'interactive_continuation_operation_marked_unknown');
        assert.strictEqual(rendererCrash.record.status, 'unknown');

        const envelopeConflict = buildClaim('continuation-5', '2026-07-16T14:00:00.000Z');
        assert.strictEqual((await hostA.claim(envelopeConflict)).success, true);
        const changedEnvelope = {
            ...envelopeConflict,
            continuation: {
                ...envelopeConflict.continuation,
                operation: {
                    ...envelopeConflict.continuation.operation,
                    params: { countPerSize: 999 }
                }
            }
        };
        const rejectedEnvelope = await hostA.claim(changedEnvelope);
        assert.strictEqual(rejectedEnvelope.success, false);
        assert.strictEqual(
            rejectedEnvelope.code,
            'interactive_continuation_operation_envelope_conflict'
        );

        const preExecutionFailureClaim = buildClaim(
            'continuation-6',
            '2026-07-16T15:00:00.000Z'
        );
        assert.strictEqual((await hostA.claim(preExecutionFailureClaim)).success, true);
        const preExecutionFailure = await hostA.settle({
            ...preExecutionFailureClaim,
            status: 'failed',
            summary: 'Photoshop 文档已经切换'
        }, 'renderer-a');
        assert.strictEqual(preExecutionFailure.success, true);
        assert.strictEqual(preExecutionFailure.record.status, 'failed');
        assert.strictEqual(
            preExecutionFailure.code,
            'interactive_continuation_operation_failed_before_execution'
        );

        const noMutationFailureClaim = buildClaim(
            'continuation-7',
            '2026-07-16T16:00:00.000Z'
        );
        assert.strictEqual((await hostA.claim(noMutationFailureClaim)).success, true);
        assert.strictEqual((await hostA.begin({
            ...noMutationFailureClaim,
            executionRunId: 'run-7'
        }, 'renderer-a')).success, true);
        const noMutationFailure = await hostA.settle({
            ...noMutationFailureClaim,
            status: 'failed',
            mutationState: 'none',
            executionRunId: 'run-7',
            summary: '模型预算耗尽，业务执行尚未产生写入'
        }, 'renderer-a');
        assert.strictEqual(noMutationFailure.success, true);
        assert.strictEqual(
            noMutationFailure.code,
            'interactive_continuation_operation_failed_without_mutation'
        );
        assert.strictEqual(noMutationFailure.record.status, 'failed');
        assert.strictEqual(noMutationFailure.record.mutationState, 'none');
        assert(!noMutationFailure.message.includes('已经开始后'));

        const executionFailureClaim = buildClaim(
            'continuation-7-observed',
            '2026-07-16T16:05:00.000Z'
        );
        assert.strictEqual((await hostA.claim(executionFailureClaim)).success, true);
        assert.strictEqual((await hostA.begin({
            ...executionFailureClaim,
            executionRunId: 'run-7-observed'
        }, 'renderer-a')).success, true);
        const executionFailure = await hostA.settle({
            ...executionFailureClaim,
            status: 'failed',
            mutationState: 'observed',
            executionRunId: 'run-7-observed',
            summary: '第 3 个 SKU 写入时连接中断'
        }, 'renderer-a');
        assert.strictEqual(executionFailure.success, true);
        assert.strictEqual(
            executionFailure.code,
            'interactive_continuation_operation_unknown_after_execution_failure'
        );
        assert.strictEqual(executionFailure.record.status, 'unknown');
        const executionFailureReplay = await hostA.begin({
            ...executionFailureClaim,
            executionRunId: 'run-7-observed-replay'
        }, 'renderer-a');
        assert.strictEqual(executionFailureReplay.success, false);
        assert.strictEqual(
            executionFailureReplay.code,
            'interactive_continuation_operation_unknown'
        );

        const unknownMutationFailureClaim = buildClaim(
            'continuation-7-unknown',
            '2026-07-16T16:10:00.000Z'
        );
        assert.strictEqual((await hostA.claim(unknownMutationFailureClaim)).success, true);
        assert.strictEqual((await hostA.begin({
            ...unknownMutationFailureClaim,
            executionRunId: 'run-7-unknown'
        }, 'renderer-a')).success, true);
        const unknownMutationFailure = await hostA.settle({
            ...unknownMutationFailureClaim,
            status: 'failed',
            executionRunId: 'run-7-unknown',
            summary: '旧执行器没有返回修改统计'
        }, 'renderer-a');
        assert.strictEqual(unknownMutationFailure.success, true);
        assert.strictEqual(unknownMutationFailure.record.status, 'unknown');
        assert.strictEqual(unknownMutationFailure.record.mutationState, 'unknown');
        assert(!unknownMutationFailure.message.includes('已经开始后'));

        const staleSettlementClaim = buildClaim(
            'continuation-8',
            '2026-07-16T17:00:00.000Z'
        );
        assert.strictEqual((await hostA.claim(staleSettlementClaim)).success, true);
        assert.strictEqual((await hostA.begin({
            ...staleSettlementClaim,
            executionRunId: 'run-8'
        }, 'renderer-a')).success, true);
        const staleSettlement = await hostA.settle({
            ...staleSettlementClaim,
            status: 'succeeded',
            executionRunId: 'stale-run',
            summary: '过期运行误报成功'
        }, 'renderer-a');
        assert.strictEqual(staleSettlement.success, false);
        assert.strictEqual(
            staleSettlement.code,
            'interactive_continuation_operation_execution_run_mismatch'
        );
        assert.strictEqual(staleSettlement.record.status, 'running');
        const invalidSettlement = await hostA.settle({
            ...staleSettlementClaim,
            status: 'running',
            executionRunId: 'run-8',
            summary: '非法 IPC 状态'
        }, 'renderer-a');
        assert.strictEqual(invalidSettlement.success, false);
        assert.strictEqual(
            invalidSettlement.code,
            'interactive_continuation_operation_invalid_settlement_status'
        );
        const runningAfterInvalidSettlement = await hostA.get(
            staleSettlementClaim.continuationId,
            'renderer-a'
        );
        assert.strictEqual(runningAfterInvalidSettlement.record.status, 'running');
        const authoritativeSettlement = await hostA.settle({
            ...staleSettlementClaim,
            status: 'succeeded',
            executionRunId: 'run-8',
            summary: '权威运行完成'
        }, 'renderer-a');
        assert.strictEqual(authoritativeSettlement.success, true);
        assert.strictEqual(authoritativeSettlement.record.status, 'succeeded');

        const ownerIsolationClaim = buildClaim(
            'continuation-9',
            '2026-07-16T18:00:00.000Z'
        );
        assert.strictEqual((await hostA.claim(ownerIsolationClaim)).success, true);
        assert.strictEqual((await hostA.begin({
            ...ownerIsolationClaim,
            executionRunId: 'run-9'
        }, 'renderer-a')).success, true);
        const nonOwnerRead = await hostA.get(ownerIsolationClaim.continuationId, 'renderer-b');
        assert.strictEqual(nonOwnerRead.success, false);
        assert.strictEqual(
            nonOwnerRead.code,
            'interactive_continuation_operation_owned_by_other_renderer'
        );
        assert.strictEqual(nonOwnerRead.record.status, 'running');
        const nonOwnerBegin = await hostA.begin({
            ...ownerIsolationClaim,
            executionRunId: 'run-9-other'
        }, 'renderer-b');
        assert.strictEqual(nonOwnerBegin.success, false);
        assert.strictEqual(
            nonOwnerBegin.code,
            'interactive_continuation_operation_owned_by_other_renderer'
        );
        assert.strictEqual(nonOwnerBegin.record.status, 'running');
        const ownerStillRunning = await hostA.get(
            ownerIsolationClaim.continuationId,
            'renderer-a'
        );
        assert.strictEqual(ownerStillRunning.success, true);
        assert.strictEqual(ownerStillRunning.record.status, 'running');
        const ownerSettlement = await hostA.settle({
            ...ownerIsolationClaim,
            status: 'succeeded',
            executionRunId: 'run-9',
            summary: '原所有者完成'
        }, 'renderer-a');
        assert.strictEqual(ownerSettlement.success, true);
        assert.strictEqual(ownerSettlement.record.status, 'succeeded');

        const missingRunClaim = buildClaim(
            'continuation-10',
            '2026-07-16T19:00:00.000Z'
        );
        assert.strictEqual((await hostA.claim(missingRunClaim)).success, true);
        const missingRun = await hostA.begin(missingRunClaim, 'renderer-a');
        assert.strictEqual(missingRun.success, false);
        assert.strictEqual(
            missingRun.code,
            'interactive_continuation_operation_missing_execution_run'
        );

        await runRendererLifecycleHandlerAssertions(rootDir);

        const temporaryFiles = fs.readdirSync(rootDir).filter((name) => name.includes('.tmp-'));
        assert.deepStrictEqual(temporaryFiles, []);

        console.log(JSON.stringify({
            ok: true,
            checked: [
                'semantic-submission-fingerprint',
                'system-and-missing-owner-claim-rejected',
                'source-card-definition-claim-binding',
                'renderer-generation-envelope-validation',
                'ledger-unavailable-message-respects-execution-phase',
                'settlement-persistence-message-preserves-business-result',
                'idempotent-claim-before-execution',
                'single-winner-concurrent-begin',
                'terminal-success-no-replay',
                'stale-running-becomes-unknown',
                'renderer-crash-running-becomes-unknown',
                'unknown-never-auto-replays',
                'pre-execution-failure-is-safe-terminal',
                'post-begin-zero-mutation-failure-is-terminal-failed',
                'post-begin-observed-mutation-failure-becomes-unknown',
                'missing-mutation-summary-remains-unknown',
                'stale-execution-run-cannot-settle',
                'invalid-settlement-status-cannot-succeed',
                'non-owner-observation-does-not-mutate-running',
                'execution-run-token-required',
                'late-old-renderer-cannot-retire-current-generation',
                'same-epoch-unknown-renderer-cannot-replace-current-generation',
                'tampered-submission-rejected',
                'immutable-continuation-envelope',
                'atomic-write-no-temp-residue'
            ]
        }, null, 2));
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
