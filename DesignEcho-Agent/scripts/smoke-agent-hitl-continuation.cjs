'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.json'),
    compilerOptions: {
        module: 'CommonJS',
        moduleResolution: 'node'
    }
});

const {
    attachPendingInteractiveContinuation,
    buildInteractiveCardSubmissionDecision,
    buildInteractiveContinuationClaim,
    buildPendingInteractiveContinuation,
    findPendingInteractiveContinuation,
    resolvePendingInteractiveContinuationLeaf,
    resolveInteractiveContinuationOperationRequest,
    resolveOwnedInteractiveContinuationRequest
} = require(path.resolve(
    __dirname,
    '..',
    'src',
    'shared',
    'pending-interactive-continuation.ts'
));
const {
    resolveSkillExecutionOutcome
} = require(path.resolve(
    __dirname,
    '..',
    'src',
    'shared',
    'agent-react-observation-contract.ts'
));
const {
    executeSkillWithExecutor,
    registerSkillExecutor
} = require(path.resolve(
    __dirname,
    '..',
    'src',
    'renderer',
    'services',
    'skill-executors',
    'registry.ts'
));
const {
    collectPendingInteractiveConfirmationCards,
    collectPendingInteractiveContinuations
} = require(path.resolve(
    __dirname,
    '..',
    'src',
    'renderer',
    'services',
    'agent-runtime',
    'agent.ts'
));
const {
    DesignAgentEngine
} = require(path.resolve(
    __dirname,
    '..',
    'src',
    'renderer',
    'services',
    'design-agent',
    'engine.ts'
));
const {
    convertLegacyMessage
} = require(path.resolve(
    __dirname,
    '..',
    'src',
    'renderer',
    'components',
    'message',
    'parser.ts'
));

const repoRoot = path.resolve(__dirname, '..');
function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function buildCard(id = 'card-1') {
    return {
        version: 'interactive-card/v0',
        id,
        kind: 'sku_combo_editor',
        title: '确认组合',
        payload: {
            version: 'sku-combo-editor/v0',
            colorSlots: [
                { slot: 1, label: '白色' },
                { slot: 2, label: '绿色' }
            ],
            requiredSizes: [2],
            initialValue: { groups: [{ size: 2, combos: [[1, 2]] }] }
        }
    };
}

function buildSubmission(card) {
    const value = { groups: [{ size: 2, combos: [[1, 2]] }], generateSelfSelectNotes: false };
    return {
        version: 'interactive-card-submission/v0',
        cardId: card.id,
        kind: card.kind,
        submittedAt: '2026-07-16T10:00:00.000Z',
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

function buildEditableCard(id, title = '确认设计内容') {
    return {
        version: 'interactive-card/v0',
        id,
        kind: 'editable_confirmation',
        title,
        payload: {
            version: 'editable-confirmation/v0',
            fields: [{ id: 'content', label: '内容', type: 'short_text', value: '初稿' }]
        }
    };
}

function buildFixture() {
    const card = buildCard();
    const result = {
        success: true,
        data: {
            status: 'pending_sku_combo_confirmation',
            requiresUserAction: true,
            interactiveCards: [card]
        }
    };
    const outcome = resolveSkillExecutionOutcome(result);
    assert.strictEqual(
        outcome.status,
        'awaiting_confirmation',
        '真实 SKU pending 状态必须由通用交互语义归一为 awaiting_confirmation'
    );
    const continuation = buildPendingInteractiveContinuation({
        skillId: 'sku-batch',
        params: { requireSkuComboConfirmation: true, countPerSize: 5 },
        result,
        outcomeStatus: outcome.status,
        sourceTask: '帮我做 SKU',
        requestId: 'run-1',
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:\\WORK\\C-1',
        scopeObservation: {
            version: 'pending-interactive-continuation-scope-observation/v0',
            observedAt: '2026-07-16T09:00:01.000Z',
            source: 'pause_boundary_get_document_info',
            photoshopDocumentState: 'present',
            photoshopDocumentId: 42
        },
        createdAt: '2026-07-16T09:00:00.000Z'
    });
    assert(continuation, '真实 pending SKU result 应创建 continuation');
    assert.strictEqual(continuation.card.id, card.id);
    assert.strictEqual(continuation.scope.photoshopDocumentId, 42);
    assert.strictEqual(continuation.scopeObservation.photoshopDocumentState, 'present');
    return { card, continuation, submission: buildSubmission(card) };
}

function runContractAssertions() {
    const { card, continuation, submission } = buildFixture();
    const owner = {
        id: 'message-1',
        interactiveCards: [card],
        pendingInteractiveContinuation: continuation,
        interactiveCardSubmissions: []
    };
    const claim = buildInteractiveContinuationClaim({
        ownerMessage: owner,
        submission,
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'e:/work/c-1/'
    });
    assert.strictEqual(claim.status, 'accepted');
    assert.strictEqual(claim.nextSubmissions.length, 1);
    assert.strictEqual(claim.request.continuationId, continuation.id);

    const documentBoundSubmissionDecision = buildInteractiveCardSubmissionDecision({
        ownerMessage: owner,
        submission,
        mode: 'resume_required',
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'e:/work/c-1/'
    });
    assert.strictEqual(
        documentBoundSubmissionDecision.status,
        'resume_operation',
        'UI 认领阶段没有实时文档 ID，不能把合法的文档绑定 continuation 误判为跨文档'
    );

    const claimedOwner = { ...owner, interactiveCardSubmissions: claim.nextSubmissions };
    const resolution = resolveOwnedInteractiveContinuationRequest({
        ownerMessage: claimedOwner,
        request: claim.request,
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1',
        photoshopDocumentId: 42
    });
    assert.strictEqual(resolution.status, 'accepted');
    assert.strictEqual(resolution.skillId, 'sku-batch');
    assert.strictEqual(resolution.params.countPerSize, 5);
    assert.strictEqual(resolution.params.interactiveCardSubmission, submission);
    assert.strictEqual(resolution.params.interactiveCardDefinition.id, 'card-1');
    assert.strictEqual(
        findPendingInteractiveContinuation({
            data: {
                interactiveCards: [card],
                pendingInteractiveContinuation: continuation
            }
        }).id,
        continuation.id
    );

    const ledgerBackedResolution = resolveOwnedInteractiveContinuationRequest({
        ownerMessage: owner,
        request: claim.request,
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1',
        photoshopDocumentId: 42,
        submission
    });
    assert.strictEqual(ledgerBackedResolution.status, 'accepted');
    assert.strictEqual(
        ledgerBackedResolution.submission,
        submission,
        'Engine 应能使用操作账本返回的权威 submission，而不是要求 UI 先消费卡片'
    );
    const envelopeResolution = resolveInteractiveContinuationOperationRequest({
        continuation,
        submission,
        request: claim.request,
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1',
        photoshopDocumentId: 42
    });
    assert.strictEqual(envelopeResolution.status, 'accepted');
    assert.strictEqual(envelopeResolution.skillId, 'sku-batch');
    assert.strictEqual(envelopeResolution.params.countPerSize, 5);
    const sourceCardFingerprintMismatch = resolveInteractiveContinuationOperationRequest({
        continuation,
        submission,
        request: { ...claim.request, sourceCardFingerprint: 'mismatched-card-definition' },
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1',
        photoshopDocumentId: 42
    });
    assert.strictEqual(sourceCardFingerprintMismatch.status, 'rejected');
    assert.strictEqual(
        sourceCardFingerprintMismatch.code,
        'interactive_continuation_source_card_definition_mismatch'
    );

    for (const [skillId, expectedCode] of [
        ['autonomous-agent', 'interactive_continuation_owner_skill_not_user_facing'],
        ['removed-skill-owner', 'interactive_continuation_owner_skill_missing']
    ]) {
        const historicalContinuation = {
            ...continuation,
            operation: { ...continuation.operation, skillId }
        };
        const historicalOwner = {
            ...owner,
            pendingInteractiveContinuation: historicalContinuation
        };
        const historicalClaim = buildInteractiveContinuationClaim({
            ownerMessage: historicalOwner,
            submission,
            conversationId: 'conversation-1',
            projectId: 'project-1',
            projectPath: 'E:/WORK/C-1'
        });
        assert.strictEqual(historicalClaim.status, 'rejected');
        assert.strictEqual(historicalClaim.code, expectedCode);
        const historicalResolution = resolveInteractiveContinuationOperationRequest({
            continuation: historicalContinuation,
            submission,
            request: claim.request,
            conversationId: 'conversation-1',
            projectId: 'project-1',
            projectPath: 'E:/WORK/C-1',
            photoshopDocumentId: 42
        });
        assert.strictEqual(historicalResolution.status, 'rejected');
        assert.strictEqual(historicalResolution.code, expectedCode);
    }

    const mismatchedSourceCardClaim = buildInteractiveContinuationClaim({
        ownerMessage: {
            ...owner,
            interactiveCards: [{ ...card, title: '同 ID 的另一张来源卡' }]
        },
        submission,
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1'
    });
    assert.strictEqual(mismatchedSourceCardClaim.status, 'rejected');
    assert.strictEqual(
        mismatchedSourceCardClaim.code,
        'interactive_continuation_source_card_definition_mismatch'
    );

    const tamperedExecutableRequest = {
        ...claim.request,
        skillId: 'main-image',
        params: { countPerSize: 999 },
        submission: { ...submission, value: { groups: [] } }
    };
    const authoritativeResolution = resolveOwnedInteractiveContinuationRequest({
        ownerMessage: claimedOwner,
        request: tamperedExecutableRequest,
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1',
        photoshopDocumentId: 42
    });
    assert.strictEqual(authoritativeResolution.status, 'accepted');
    assert.strictEqual(authoritativeResolution.skillId, 'sku-batch');
    assert.strictEqual(authoritativeResolution.params.countPerSize, 5);
    assert.strictEqual(authoritativeResolution.submission.value.groups.length, 1);

    const duplicate = buildInteractiveContinuationClaim({
        ownerMessage: claimedOwner,
        submission,
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1'
    });
    assert.strictEqual(duplicate.status, 'rejected');
    assert.strictEqual(duplicate.code, 'interactive_continuation_already_claimed');

    const staleConversation = resolveOwnedInteractiveContinuationRequest({
        ownerMessage: claimedOwner,
        request: claim.request,
        conversationId: 'conversation-2',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1'
    });
    assert.strictEqual(staleConversation.status, 'rejected');
    assert.strictEqual(staleConversation.code, 'interactive_continuation_conversation_mismatch');

    const crossProject = resolveOwnedInteractiveContinuationRequest({
        ownerMessage: claimedOwner,
        request: claim.request,
        conversationId: 'conversation-1',
        projectId: 'project-2',
        projectPath: 'E:/WORK/C-1'
    });
    assert.strictEqual(crossProject.status, 'rejected');
    assert.strictEqual(crossProject.code, 'interactive_continuation_project_mismatch');

    const wrongCard = resolveOwnedInteractiveContinuationRequest({
        ownerMessage: claimedOwner,
        request: { ...claim.request, cardId: 'other-card' },
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1'
    });
    assert.strictEqual(wrongCard.status, 'rejected');
    assert.strictEqual(wrongCard.code, 'interactive_continuation_card_mismatch');

    const correctPhotoshopDocument = resolveOwnedInteractiveContinuationRequest({
        ownerMessage: claimedOwner,
        request: claim.request,
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1',
        photoshopDocumentId: 42
    });
    assert.strictEqual(correctPhotoshopDocument.status, 'accepted');

    const changedPhotoshopDocument = resolveOwnedInteractiveContinuationRequest({
        ownerMessage: {
            ...claimedOwner,
            pendingInteractiveContinuation: continuation
        },
        request: claim.request,
        conversationId: 'conversation-1',
        projectId: 'project-1',
        projectPath: 'E:/WORK/C-1',
        photoshopDocumentId: 99
    });
    assert.strictEqual(changedPhotoshopDocument.status, 'rejected');
    assert.strictEqual(
        changedPhotoshopDocument.code,
        'interactive_continuation_photoshop_document_mismatch'
    );

    const recordOnlyCard = {
        version: 'interactive-card/v0',
        id: 'record-only-card',
        kind: 'editable_confirmation',
        title: '确认设计偏好',
        payload: { version: 'editable-confirmation/v0', fields: [] }
    };
    const recordOnlySubmission = buildSubmission(recordOnlyCard);
    const recordOnlyDecision = buildInteractiveCardSubmissionDecision({
        ownerMessage: {
            id: 'record-only-message',
            interactiveCards: [recordOnlyCard],
            interactiveCardSubmissions: []
        },
        submission: recordOnlySubmission,
        mode: 'record_or_resume'
    });
    assert.strictEqual(recordOnlyDecision.status, 'record_only');
    assert.strictEqual(recordOnlyDecision.nextSubmissions.length, 1);

    const missingBusinessContinuation = buildInteractiveCardSubmissionDecision({
        ownerMessage: {
            id: 'orphaned-sku-message',
            interactiveCards: [card],
            interactiveCardSubmissions: []
        },
        submission,
        mode: 'resume_required'
    });
    assert.strictEqual(missingBusinessContinuation.status, 'rejected');
    assert.strictEqual(missingBusinessContinuation.code, 'interactive_continuation_missing_owner');

    assert.throws(() => buildPendingInteractiveContinuation({
        skillId: 'sku-batch',
        params: {},
        result: {
            data: {
                interactiveCards: [card, buildCard('card-2')]
            }
        },
        outcomeStatus: 'awaiting_confirmation'
    }), /只能绑定一张确认卡/);

    const parsed = convertLegacyMessage({
        id: owner.id,
        role: 'assistant',
        content: '请确认组合。',
        timestamp: Date.now(),
        interactiveCards: [card],
        interactiveCardSubmissions: [submission]
    });
    const cardBlock = parsed.blocks.find((block) => block.type === 'interactive_card');
    assert(cardBlock, '来源消息必须渲染交互卡');
    assert.strictEqual(cardBlock.sourceMessageId, owner.id);
    assert.strictEqual(cardBlock.submission.cardId, card.id);
}

async function runRegistryAssertion() {
    const card = buildCard('registry-card');
    registerSkillExecutor({
        skillId: 'visual-analysis',
        execute: async () => ({
            success: true,
            message: '等待确认',
            data: {
                status: 'pending_domain_specific_confirmation',
                requiresUserAction: true,
                interactiveCards: [card]
            }
        })
    });
    const result = await executeSkillWithExecutor('visual-analysis', {
        params: { userIntent: '确认后继续' },
        context: {
            userInput: '确认后继续',
            requestId: 'registry-run',
            conversationId: 'registry-conversation',
            projectContext: { projectId: 'registry-project', projectPath: 'C:\\Project' },
            operatingContextSnapshot: {
                photoshop: {
                    documentState: 'present',
                    document: { documentId: 2147483647 }
                }
            }
        }
    });
    assert.strictEqual(result.skillOutcome.status, 'awaiting_confirmation');
    assert(result.data.pendingInteractiveContinuation, 'Registry 必须为真实待确认结果附加 continuation');
    assert.strictEqual(result.data.pendingInteractiveContinuation.card.id, card.id);
    assert.strictEqual(
        result.data.pendingInteractiveContinuation.scopeObservation.source,
        'pause_boundary_get_document_info'
    );
    assert.notStrictEqual(
        result.data.pendingInteractiveContinuation.scope.photoshopDocumentId,
        2147483647,
        'Registry 不得把请求开始时的旧文档绑定到暂停后的 continuation'
    );
    const scopeObservation = result.data.pendingInteractiveContinuation.scopeObservation;
    assert(
        ['present', 'absent', 'unknown'].includes(scopeObservation.photoshopDocumentState),
        '暂停边界必须明确记录文档证据状态'
    );
    if (scopeObservation.photoshopDocumentState === 'present') {
        assert.strictEqual(
            result.data.pendingInteractiveContinuation.scope.photoshopDocumentId,
            scopeObservation.photoshopDocumentId,
            '有新鲜文档证据时，continuation 只能绑定该文档'
        );
    } else {
        assert.strictEqual(
            result.data.pendingInteractiveContinuation.scope.photoshopDocumentId,
            undefined,
            '没有新鲜文档证据时不得绑定请求开始时的旧文档'
        );
    }
}

async function runRegistryOwnershipAssertions() {
    const leafCard = buildEditableCard('leaf-owner-card');
    const leafResult = {
        success: true,
        message: '等待确认',
        data: {
            status: 'pending_domain_specific_confirmation',
            requiresUserAction: true,
            interactiveCards: [leafCard]
        }
    };
    const leafContinuation = buildPendingInteractiveContinuation({
        skillId: 'visual-analysis',
        params: { focus: 'layout' },
        result: leafResult,
        outcomeStatus: 'awaiting_confirmation',
        sourceTask: '确认分析结果后继续',
        requestId: 'leaf-run',
        conversationId: 'leaf-conversation',
        projectId: 'leaf-project',
        projectPath: 'C:\\LeafProject',
        scopeObservation: {
            version: 'pending-interactive-continuation-scope-observation/v0',
            observedAt: '2026-07-22T09:00:00.000Z',
            source: 'pause_boundary_get_document_info',
            photoshopDocumentState: 'present',
            photoshopDocumentId: 77
        },
        createdAt: '2026-07-22T09:00:00.000Z'
    });
    assert(leafContinuation, '叶子 Skill 应先签发 continuation');

    registerSkillExecutor({
        skillId: 'autonomous-agent',
        execute: async () => ({
            ...leafResult,
            data: {
                ...leafResult.data,
                pendingInteractiveContinuation: leafContinuation
            }
        })
    });
    const wrappedLeafResult = await executeSkillWithExecutor('autonomous-agent', {
        params: { userTask: '确认分析结果后继续' },
        context: {
            userInput: '确认分析结果后继续',
            requestId: 'outer-run',
            conversationId: 'leaf-conversation',
            projectContext: { projectId: 'leaf-project', projectPath: 'C:\\LeafProject' }
        }
    });
    const wrappedLeaf = resolvePendingInteractiveContinuationLeaf(wrappedLeafResult);
    assert(wrappedLeaf, '外层编排结果必须继续携带叶子 continuation');
    assert.strictEqual(wrappedLeaf, leafContinuation, '外层编排器必须透传原叶子对象，不能重签或覆盖');
    assert.strictEqual(wrappedLeaf.operation.skillId, 'visual-analysis');
    assert.strictEqual(wrappedLeaf.scope.photoshopDocumentId, 77, '外层收尾不得重新观察并改绑 Photoshop 状态');

    const conflictingOwner = buildPendingInteractiveContinuation({
        skillId: 'copywriting',
        params: {},
        result: leafResult,
        outcomeStatus: 'awaiting_confirmation',
        sourceTask: '另一项操作',
        createdAt: '2026-07-22T09:01:00.000Z'
    });
    assert(conflictingOwner);
    assert.throws(
        () => attachPendingInteractiveContinuation(wrappedLeafResult, conflictingOwner),
        /挂起操作所有权冲突/,
        '不同 owner/id 不得静默覆盖已有叶子 continuation'
    );
    assert.throws(
        () => findPendingInteractiveContinuation({
            interactiveCards: [leafCard],
            pendingInteractiveContinuation: leafContinuation,
            data: {
                interactiveCards: [leafCard],
                pendingInteractiveContinuation: {
                    ...leafContinuation,
                    operation: {
                        ...leafContinuation.operation,
                        params: { focus: '被篡改的执行参数' }
                    }
                }
            }
        }),
        /多个不同的挂起操作 owner/,
        '同 owner/id 的投影也必须保持完整 continuation 定义一致'
    );
    assert.throws(
        () => resolvePendingInteractiveContinuationLeaf({
            ...wrappedLeafResult,
            data: {
                ...wrappedLeafResult.data,
                interactiveCards: [{ ...leafCard, title: '被替换的卡片内容' }]
            }
        }),
        /挂起操作与当前确认卡不一致/,
        '透传叶子 continuation 前必须校验完整卡片定义'
    );
    assert.throws(
        () => findPendingInteractiveContinuation({
            ...wrappedLeafResult,
            interactiveCards: [leafCard],
            data: {
                ...wrappedLeafResult.data,
                interactiveCards: [{ ...leafCard, title: '同 ID 的冲突卡片版本' }]
            }
        }),
        /相同卡片 ID 的不同定义/,
        '同一执行结果内的同 ID 卡片只有定义完全相同时才能去重'
    );

    const genericCard = buildEditableCard('autonomous-generic-card');
    registerSkillExecutor({
        skillId: 'autonomous-agent',
        execute: async () => ({
            success: true,
            message: '等待确认',
            data: {
                status: 'pending_generic_confirmation',
                requiresUserAction: true,
                interactiveCards: [genericCard]
            }
        })
    });
    const genericResult = await executeSkillWithExecutor('autonomous-agent', {
        params: { userTask: '请确认这段内容' },
        context: {
            userInput: '请确认这段内容',
            requestId: 'generic-run',
            conversationId: 'generic-conversation'
        }
    });
    assert.strictEqual(genericResult.skillOutcome.status, 'awaiting_confirmation');
    assert.strictEqual(
        findPendingInteractiveContinuation(genericResult),
        undefined,
        'system-only 编排器只有通用卡而没有叶子 owner 时，不得制造可执行 continuation'
    );
}

function runAgentAggregationAssertions() {
    const card = buildEditableCard('aggregate-card', '原始卡片');
    const changedCard = { ...card, title: '冲突卡片' };
    assert.throws(
        () => collectPendingInteractiveConfirmationCards([
            { success: true, output: { interactiveCards: [card] } },
            { success: true, output: { interactiveCards: [changedCard] } }
        ]),
        /相同卡片 ID 的不同定义/,
        '跨 toolResults 的同 ID 卡片不同定义必须 fail closed'
    );

    const baseResult = {
        success: true,
        data: { interactiveCards: [card] }
    };
    const continuation = buildPendingInteractiveContinuation({
        skillId: 'visual-analysis',
        params: { focus: 'layout' },
        result: baseResult,
        outcomeStatus: 'awaiting_confirmation',
        sourceTask: '确认后继续',
        createdAt: '2026-07-22T10:30:00.000Z'
    });
    assert(continuation);
    const changedContinuation = {
        ...continuation,
        card: changedCard
    };
    assert.throws(
        () => collectPendingInteractiveContinuations([
            {
                success: true,
                output: {
                    data: {
                        interactiveCards: [card],
                        pendingInteractiveContinuation: continuation
                    }
                }
            },
            {
                success: true,
                output: {
                    data: {
                        interactiveCards: [changedCard],
                        pendingInteractiveContinuation: changedContinuation
                    }
                }
            }
        ]),
        /相同 continuation ID 的不同定义/,
        '跨 toolResults 的同 ID continuation 不得 first-wins'
    );
}

async function runEngineZeroModelResumeAssertion() {
    const card = buildCard('engine-zero-model-card');
    const pausedResult = {
        success: true,
        data: {
            status: 'pending_sku_combo_confirmation',
            requiresUserAction: true,
            interactiveCards: [card]
        }
    };
    const continuation = buildPendingInteractiveContinuation({
        skillId: 'sku-batch',
        params: { requireSkuComboConfirmation: true, countPerSize: 5 },
        result: pausedResult,
        outcomeStatus: 'awaiting_confirmation',
        sourceTask: '帮我做 SKU',
        requestId: 'engine-original-run',
        conversationId: 'engine-conversation',
        projectId: 'engine-project',
        projectPath: 'C:\\EngineProject',
        createdAt: '2026-07-22T10:00:00.000Z'
    });
    assert(continuation, 'Engine 续跑用例必须先有叶子 continuation');
    const submission = buildSubmission(card);
    const claim = buildInteractiveContinuationClaim({
        ownerMessage: {
            id: 'engine-source-message',
            interactiveCards: [card],
            pendingInteractiveContinuation: continuation,
            interactiveCardSubmissions: []
        },
        submission,
        conversationId: 'engine-conversation',
        projectId: 'engine-project',
        projectPath: 'C:\\EngineProject'
    });
    assert.strictEqual(claim.status, 'accepted');

    let modelCalls = 0;
    let leafExecutions = 0;
    let beginCalls = 0;
    let settleCalls = 0;
    registerSkillExecutor({
        skillId: 'sku-batch',
        resolvePreExecutionResult: (params) => {
            leafExecutions += 1;
            assert.strictEqual(params.params.interactiveCardSubmission.cardId, card.id);
            return {
                success: true,
                message: 'SKU 组合已执行。',
                executionSummary: {
                    status: 'completed',
                    successfulMutationCalls: 1
                }
            };
        },
        execute: async () => {
            throw new Error('确认续跑应由同一叶子执行入口直接承接');
        }
    });

    const previousWindow = global.window;
    global.window = {
        designEcho: {
            invoke: async (channel) => {
                if (channel === 'interactiveContinuation:get') {
                    return {
                        success: true,
                        code: 'interactive_continuation_operation_found',
                        message: 'found',
                        record: {
                            status: 'claimed',
                            submission,
                            continuation
                        }
                    };
                }
                if (channel === 'interactiveContinuation:begin') {
                    beginCalls += 1;
                    return {
                        success: true,
                        code: 'interactive_continuation_operation_running',
                        message: 'running',
                        record: { status: 'running', submission, continuation }
                    };
                }
                if (channel === 'interactiveContinuation:settle') {
                    settleCalls += 1;
                    return {
                        success: true,
                        code: 'interactive_continuation_operation_succeeded',
                        message: 'settled',
                        record: { status: 'succeeded', submission, continuation }
                    };
                }
                throw new Error(`unexpected invoke channel: ${channel}`);
            }
        }
    };

    try {
        const engine = new DesignAgentEngine();
        const result = await engine.run({
            userInput: '',
            conversationId: 'engine-conversation',
            projectContext: {
                projectId: 'engine-project',
                projectPath: 'C:\\EngineProject'
            },
            interactiveContinuationRequest: claim.request
        }, {
            callModel: async () => {
                modelCalls += 1;
                return { text: '不应调用模型' };
            },
            callbacks: {}
        });
        assert.strictEqual(result.success, true, JSON.stringify(result));
        assert.strictEqual(modelCalls, 0, '确认续跑不得重新进入 router 或 Agent 模型循环');
        assert.strictEqual(leafExecutions, 1, '确认续跑必须且只能执行一次原叶子 Skill');
        assert.strictEqual(beginCalls, 1, '确认续跑必须只取得一次执行权');
        assert.strictEqual(settleCalls, 1, '确认续跑必须只结算一次');
        assert.strictEqual(result.data.interactiveContinuationResolution.status, 'executed');
    } finally {
        global.window = previousWindow;
    }
}

function runProductionWiringAssertions() {
    const chatPanel = read('src/renderer/components/ChatPanel.tsx');
    const engine = read('src/renderer/services/design-agent/engine.ts');
    const registry = read('src/renderer/services/skill-executors/registry.ts');
    const skuExecutor = read('src/renderer/services/skill-executors/sku-batch.executor.ts');
    const agent = read('src/renderer/services/agent-runtime/agent.ts');
    const interactiveCardBlock = read('src/renderer/components/message/blocks/InteractiveCardBlock.tsx');
    const ipcHandlers = read('src/main/ipc-handlers/interactive-continuation-operation-handlers.ts');
    const ledgerClient = read('src/renderer/services/interactive-continuation-operation-client.ts');

    assert(chatPanel.includes('buildInteractiveCardSubmissionDecision'));
    assert(chatPanel.includes("await prepareInteractiveCardSubmission(submission, 'record_or_resume')"));
    assert(chatPanel.includes("await prepareInteractiveCardSubmission(submission, 'resume_required')"));
    assert(chatPanel.includes('claimInteractiveContinuationOperation'));
    assert(chatPanel.includes('finalizeResumedInteractiveCardSubmission'));
    assert(chatPanel.includes('getInteractiveContinuationOperation'));
    assert(chatPanel.includes('markInteractiveContinuationOperationUnknown'));
    assert(chatPanel.includes('interactiveContinuationRequest: decision.request'));
    assert(chatPanel.includes('确认卡尚未消费'));
    assert(chatPanel.includes('!interactiveContinuationRequest && (userInput || imageToSend)'));
    assert(!chatPanel.includes('formatSkuConfirmedCombosForResume'));
    assert(engine.indexOf('if (context.interactiveContinuationRequest)') < engine.indexOf('if (isAgentMattingPaused()'));
    assert(engine.includes('resolveInteractiveContinuationOperationRequest'));
    assert(engine.includes('getInteractiveContinuationOperation'));
    assert(engine.includes('beginInteractiveContinuationOperation'));
    assert(engine.includes('settleInteractiveContinuationOperation'));
    assert(engine.includes('executeSkillTool(resolution.skillId'));
    assert(engine.includes("settlement.record?.status === 'unknown'"));
    assert(engine.includes('await getPhotoshopContext({ signal })'));
    const rejectedResolutionBlock = engine.slice(
        engine.indexOf("if (resolution.status === 'rejected')"),
        engine.indexOf("callbacks?.onStep?.({", engine.indexOf("if (resolution.status === 'rejected')"))
    );
    assert(!rejectedResolutionBlock.includes('settleInteractiveContinuationOperation'));
    assert(rejectedResolutionBlock.includes('卡片会保留'));
    assert(
        (engine.match(/executionRunId: continuationExecutionRunId/g) || []).length >= 3,
        'begin 与执行后的 settle 必须共享同一个 Agent 运行令牌'
    );
    assert(registry.includes('buildPendingInteractiveContinuation'));
    assert(registry.includes('capturePendingContinuationScopeObservation'));
    assert(registry.includes('getPhotoshopContext({ signal })'));
    assert(registry.includes('scopeObservation: pendingContinuationScopeObservation'));
    assert(!registry.includes('operatingContextSnapshot.photoshop.document.documentId'));
    assert(skuExecutor.includes('resolveStructuredSkuComboConfirmation(params, validColors)'));
    assert(skuExecutor.includes('interactiveCardSubmission'));
    assert(agent.includes('awaiting_user_confirmation_skipped'));
    assert(interactiveCardBlock.includes("execution?.status === 'failed'"));
    assert(interactiveCardBlock.includes("execution?.status === 'unknown'"));
    assert(!interactiveCardBlock.includes('确认内容已提交，原任务已承接处理。'));
    assert(ipcHandlers.includes('new WeakMap<WebContents, RendererLifecycleController>()'));
    assert(ipcHandlers.includes('randomUUID()'));
    assert(ipcHandlers.includes("'did-start-navigation'"));
    assert(ipcHandlers.includes('rendererGenerationId'));
    assert(ipcHandlers.includes('isInteractiveContinuationRendererEnvelope'));
    assert(
        ipcHandlers.indexOf('ensureRendererLifecycle(event.sender, input.rendererGenerationId)')
            < ipcHandlers.indexOf('await store.begin('),
        '渲染进程生命周期监听必须在持久化 running 之前安装'
    );
    assert(ipcHandlers.includes('lifecycle.gone || event.sender.isDestroyed()'));
    assert(ledgerClient.includes('const RENDERER_GENERATION_ID = createRendererGenerationId()'));
    assert(ledgerClient.includes('buildInteractiveContinuationRendererEnvelope'));
}

async function main() {
    runContractAssertions();
    runAgentAggregationAssertions();
    await runRegistryAssertion();
    runProductionWiringAssertions();
    await runRegistryOwnershipAssertions();
    await runEngineZeroModelResumeAssertion();
    console.log(JSON.stringify({
        ok: true,
        checked: [
            'real-pending-status-normalization',
            'registry-continuation-attachment',
            'registry-leaf-continuation-owner-preservation',
            'registry-owner-conflict-fail-closed',
            'registry-owner-projection-definition-consistency',
            'registry-leaf-card-definition-validation',
            'duplicate-card-id-definition-conflict',
            'historical-system-and-missing-owner-rejected',
            'source-message-card-definition-binding',
            'resolved-source-card-fingerprint-binding',
            'cross-tool-result-definition-conflict',
            'system-orchestrator-generic-card-record-only',
            'engine-confirmation-resume-zero-model-calls',
            'engine-confirmation-resume-exactly-once-leaf-execution',
            'authoritative-owner-operation-binding',
            'structured-card-submission',
            'durable-operation-ledger-claim',
            'ledger-canonical-submission-before-ui-consume',
            'ledger-canonical-continuation-envelope',
            'double-submit-rejection',
            'stale-conversation-rejection',
            'cross-project-rejection',
            'document-bound-ui-claim-without-live-document',
            'photoshop-document-binding',
            'pause-boundary-document-evidence',
            'single-card-one-time-invariant',
            'generic-card-record-only-contract',
            'business-card-requires-continuation',
            'source-message-rendering',
            'busy-state-no-consume-wiring',
            'no-natural-language-resubmit',
            'controlled-skill-bridge-resume'
        ]
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
