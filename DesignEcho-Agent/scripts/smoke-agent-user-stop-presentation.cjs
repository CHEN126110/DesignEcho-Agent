#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

require.extensions['.css'] = () => undefined;
require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.json'),
    compilerOptions: {
        module: 'CommonJS',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
    }
});

const ROOT = path.resolve(__dirname, '..');
const {
    buildUserStoppedResponseInterruption,
    formatAgentResponseInterruption,
    isAgentResponseInterruptionSentinelContent,
    normalizeAgentResponseInterruption,
    resolveAgentResponseInterruption,
    USER_STOPPED_RESPONSE_LABEL
} = require(path.join(ROOT, 'src/shared/agent-response-interruption.ts'));
const {
    convertLegacyMessage
} = require(path.join(ROOT, 'src/renderer/components/message/parser.ts'));
const {
    decideAgentRunResultDisposition
} = require(path.join(ROOT, 'src/shared/agent-run-result-disposition.ts'));
const {
    MessageRenderer
} = require(path.join(ROOT, 'src/renderer/components/message/MessageRenderer.tsx'));

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function buildStoppedMessage(overrides = {}) {
    return {
        id: 'stopped-message',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'ui_status',
            userVisibleKind: 'status_notice',
            source: 'agent-run:user-stopped'
        },
        agentResponseInterruption: buildUserStoppedResponseInterruption(),
        ...overrides
    };
}

function assertInterruptionContract() {
    const interruption = buildUserStoppedResponseInterruption();
    assert.deepStrictEqual(interruption, {
        version: 'agent-response-interruption/v0',
        kind: 'user_stopped'
    });
    assert.deepStrictEqual(normalizeAgentResponseInterruption(interruption), interruption);
    assert.strictEqual(normalizeAgentResponseInterruption({ kind: 'user_stopped' }), undefined);
    assert.strictEqual(formatAgentResponseInterruption(interruption), USER_STOPPED_RESPONSE_LABEL);
    assert.strictEqual(isAgentResponseInterruptionSentinelContent('⏹️ 已停止'), true);
    assert.strictEqual(isAgentResponseInterruptionSentinelContent('部分回答'), false);
    assert.deepStrictEqual(resolveAgentResponseInterruption({
        assistantReplyOrigin: {
            origin: 'ui_status',
            source: 'agent-run:stop'
        },
        content: ''
    }), interruption);
}

function assertRenderableStoppedState() {
    const stoppedBeforeFirstToken = convertLegacyMessage(buildStoppedMessage({
        thinkingSteps: [{
            id: 'running-thinking',
            type: 'thinking',
            content: 'We need to inspect the current state.',
            status: 'running',
            timestamp: Date.now()
        }],
        agentTaskPlan: {
            requestKind: 'chat_only',
            route: 'direct_response'
        }
    }));

    assert.strictEqual(
        stoppedBeforeFirstToken.blocks.length,
        0,
        'fixture must reproduce a case where persistent thinking is filtered from content blocks'
    );
    assert.deepStrictEqual(
        stoppedBeforeFirstToken.metadata?.agentResponseInterruption,
        buildUserStoppedResponseInterruption(),
        'parser must preserve the structured user-stop terminal state even when all content blocks are filtered'
    );

    const statusHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, { message: stoppedBeforeFirstToken })
    );
    assert(
        statusHtml.includes(USER_STOPPED_RESPONSE_LABEL),
        'renderer must show a user-stop label instead of an empty assistant row'
    );
    assert(
        statusHtml.includes('data-testid="agent-response-interruption"'),
        'renderer must expose a stable user-stop status hook'
    );

    const longProcessText = '停止前仍在执行一段较长的观察与判断。'.repeat(80);
    const stoppedWithPersistentProcess = convertLegacyMessage(buildStoppedMessage({
        id: 'stopped-with-persistent-process',
        thinkingSteps: [
            {
                id: 'long-reasoning',
                type: 'thinking',
                content: longProcessText,
                status: 'success',
                timestamp: Date.now()
            },
            {
                id: 'completed-tool',
                type: 'tool_result',
                content: '项目资源读取完成',
                toolName: 'listProjectResources',
                toolResult: {
                    success: true,
                    totalFiles: 44
                },
                status: 'success',
                timestamp: Date.now()
            }
        ]
    }));
    assert(
        stoppedWithPersistentProcess.blocks.some((block) => block.type === 'thinking'),
        'fixture must reproduce a stopped message that still owns persistent process blocks'
    );
    const stoppedProcessHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, { message: stoppedWithPersistentProcess })
    );
    assert(
        stoppedProcessHtml.includes('thinking-header') &&
            !stoppedProcessHtml.includes('thinking-steps') &&
            !stoppedProcessHtml.includes(longProcessText),
        'interrupted process blocks must start collapsed so they cannot push the stop label below a long hidden region'
    );
    assert(
        stoppedProcessHtml.includes(USER_STOPPED_RESPONSE_LABEL),
        'the compact process summary must remain adjacent to the visible stop terminal state'
    );

    const normalProcessSteps = [
        {
            id: 'normal-long-reasoning',
            type: 'thinking',
            content: longProcessText,
            status: 'success',
            timestamp: Date.now()
        },
        {
            id: 'normal-completed-tool',
            type: 'tool_result',
            content: '项目资源读取完成',
            toolName: 'listProjectResources',
            toolResult: {
                success: true,
                totalFiles: 44
            },
            status: 'success',
            timestamp: Date.now()
        }
    ];
    const normalPersistentProcess = convertLegacyMessage({
        ...buildStoppedMessage(),
        id: 'normal-persistent-process',
        isThinking: false,
        agentResponseInterruption: undefined,
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'model_authored',
            userVisibleKind: 'model_response',
            source: 'agent-run:normal-process'
        },
        thinkingSteps: normalProcessSteps
    });
    const normalProcessHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, {
            message: normalPersistentProcess,
            isStreaming: false
        })
    );
    assert(
        normalProcessHtml.includes('thinking-header') &&
            !normalProcessHtml.includes('thinking-steps') &&
            !normalProcessHtml.includes(longProcessText),
        'normal completed process messages must default to one compact audit summary'
    );

    const activePersistentProcess = convertLegacyMessage({
        ...buildStoppedMessage(),
        id: 'active-persistent-process',
        isThinking: true,
        agentResponseInterruption: undefined,
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'model_authored',
            userVisibleKind: 'model_response',
            source: 'agent-run:active-process'
        },
        thinkingSteps: normalProcessSteps
    });
    const activeProcessHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, {
            message: activePersistentProcess,
            isStreaming: true
        })
    );
    const activeThinkingBlock = activePersistentProcess.blocks.find(
        (block) => block.type === 'thinking'
    );
    assert.strictEqual(activeThinkingBlock?.isExpanded, true);
    assert(
        activeProcessHtml.includes('thinking-steps') &&
            activeProcessHtml.includes('查看项目资源'),
        'active process messages must remain expanded while the Agent is still running'
    );

    const screenshotStartedAt = Date.now();
    const screenshotEquivalentSteps = Array.from({ length: 30 }, (_, index) => ({
        id: `screenshot-step-${index + 1}`,
        type: index % 3 === 0 ? 'tool_call' : 'decision',
        content: `第 ${index + 1} 项真实判断与处理内容`,
        toolName: index % 3 === 0 ? 'getDocumentInfo' : undefined,
        status: index >= 24 ? 'error' : 'success',
        duration: 16140,
        timestamp: screenshotStartedAt + index
    }));
    const screenshotEquivalentTerminal = convertLegacyMessage({
        id: 'screenshot-equivalent-terminal-process',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isThinking: false,
        thinkingSteps: screenshotEquivalentSteps,
        executionSummary: {
            status: 'failed',
            stopReason: 'final_response'
        },
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'deterministic_blocker',
            userVisibleKind: 'blocker_notice',
            source: 'skill:autonomous-agent:failure'
        }
    });
    const screenshotEquivalentHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, {
            message: screenshotEquivalentTerminal,
            isStreaming: false
        })
    );
    const screenshotThinkingBlock = screenshotEquivalentTerminal.blocks.find(
        (block) => block.type === 'thinking'
    );
    assert.strictEqual(screenshotThinkingBlock?.steps.length, 30);
    assert.strictEqual(screenshotThinkingBlock?.totalDuration, 16169);
    assert.strictEqual(screenshotThinkingBlock?.isExpanded, false);
    assert(
        screenshotEquivalentHtml.includes('判断与处理') &&
            screenshotEquivalentHtml.includes('(30)') &&
            screenshotEquivalentHtml.includes('16.2s') &&
            !screenshotEquivalentHtml.includes('thinking-steps'),
        'overlapping process steps must render their wall-clock span rather than a summed duration'
    );

    const untimedProcess = convertLegacyMessage({
        id: 'untimed-process-duration-fallback',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isThinking: false,
        thinkingSteps: [
            {
                id: 'untimed-1',
                type: 'decision',
                content: '第一项处理',
                status: 'success',
                duration: 120,
                timestamp: 0
            },
            {
                id: 'untimed-2',
                type: 'decision',
                content: '第二项处理',
                status: 'success',
                duration: 250,
                timestamp: 0
            }
        ],
        executionSummary: {
            status: 'completed',
            stopReason: 'final_response'
        }
    });
    const untimedThinkingBlock = untimedProcess.blocks.find((block) => block.type === 'thinking');
    assert.strictEqual(
        untimedThinkingBlock?.totalDuration,
        250,
        'when timestamps are unavailable, duration must fall back to the single longest step instead of a sum'
    );

    const inconsistentLegacySummary = convertLegacyMessage({
        id: 'legacy-inconsistent-execution-counts',
        role: 'assistant',
        content: '当前处理未完成。',
        timestamp: Date.now(),
        executionSummary: {
            status: 'failed',
            stopReason: 'final_response',
            iterations: 4,
            businessActionCount: 6,
            harnessActionCount: 3,
            toolCallCount: 9,
            successfulToolCalls: 6,
            failedToolCalls: 0,
            acceptanceVerified: 0,
            acceptanceFailed: 0,
            acceptanceNeedsReview: 0,
            noDocumentChangeRisks: 0,
            blockers: [],
            warnings: [],
            summaryText: '处理状态：未完成。共处理 9 项，6 项已处理，0 项未完成。'
        }
    });
    const inconsistentLegacyCard = inconsistentLegacySummary.blocks.find((block) => (
        block.type === 'card' && block.title === '处理结果：未完成'
    ));
    assert(inconsistentLegacyCard, 'legacy inconsistent summary must still render a result card');
    assert(
        inconsistentLegacyCard.content.includes('共处理 6 项')
            && !inconsistentLegacyCard.content.includes('共处理 9 项')
            && inconsistentLegacyCard.details.some((detail) => (
                detail.label === '完成情况' && detail.value === '6 项完成 / 0 项未完成'
            )),
        `UI projection must normalize business-action totals: ${JSON.stringify(inconsistentLegacyCard)}`
    );

    const totalOnlyLegacySummary = convertLegacyMessage({
        id: 'legacy-total-only-execution-counts',
        role: 'assistant',
        content: '当前结果需要复核。',
        timestamp: Date.now(),
        executionSummary: {
            status: 'needs_review',
            stopReason: 'final_response',
            iterations: 2,
            businessActionCount: 4,
            toolCallCount: 7,
            acceptanceVerified: 0,
            acceptanceFailed: 0,
            acceptanceNeedsReview: 0,
            noDocumentChangeRisks: 0,
            blockers: [],
            warnings: [],
            summaryText: '处理状态：需复核。共处理 7 项。'
        }
    });
    const totalOnlyLegacyCard = totalOnlyLegacySummary.blocks.find((block) => (
        block.type === 'card' && block.title === '处理结果：需复核'
    ));
    assert(totalOnlyLegacyCard, 'total-only legacy summary must still render a result card');
    assert(
        totalOnlyLegacyCard.content.includes('共处理 4 项')
            && totalOnlyLegacyCard.content.includes('完成明细未记录')
            && totalOnlyLegacyCard.details.some((detail) => (
                detail.label === '完成情况'
                    && detail.value === '共 4 项 / 旧记录未保存完成明细'
            ))
            && !totalOnlyLegacyCard.content.includes('0 项已处理')
            && !totalOnlyLegacyCard.content.includes('0 项未完成'),
        `total-only legacy summary must not fabricate a completion split: ${JSON.stringify(totalOnlyLegacyCard)}`
    );

    const stoppedWithFailedToolResult = {
        id: 'stopped-with-failed-tool-result',
        role: 'assistant',
        timestamp: Date.now(),
        blocks: [{
            id: 'failed-tool-result',
            type: 'tool_result',
            toolName: 'getDocumentInfo',
            displayName: '读取文档信息',
            icon: '!',
            success: false,
            error: '当前没有打开的文档。',
            details: [{
                label: '详情',
                value: '这段错误详情在用户停止后默认必须收起。'
            }]
        }],
        metadata: {
            agentResponseInterruption: buildUserStoppedResponseInterruption()
        }
    };
    const stoppedToolResultHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, { message: stoppedWithFailedToolResult })
    );
    assert(
        stoppedToolResultHtml.includes('tool-result-header') &&
            !stoppedToolResultHtml.includes('tool-result-details'),
        'failed tool result details must also collapse when the response becomes user-stopped'
    );

    const legacyStoppedMessage = convertLegacyMessage({
        ...buildStoppedMessage(),
        id: 'legacy-stopped-message',
        agentResponseInterruption: undefined,
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'ui_status',
            userVisibleKind: 'status_notice',
            source: 'agent-run:stop'
        }
    });
    const legacyStatusHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, { message: legacyStoppedMessage })
    );
    assert(
        legacyStatusHtml.includes(USER_STOPPED_RESPONSE_LABEL),
        'legacy persisted agent-run:stop records must be repaired during display'
    );

    const legacyPartialMessage = convertLegacyMessage({
        ...buildStoppedMessage(),
        id: 'legacy-partial-stopped-message',
        content: '旧版本停止前已经生成的部分回答。',
        agentResponseInterruption: undefined,
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'ui_status',
            userVisibleKind: 'status_notice',
            source: 'agent-run:stop'
        }
    });
    const legacyPartialHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, { message: legacyPartialMessage })
    );
    assert(
        legacyPartialHtml.includes('旧版本停止前已经生成的部分回答。') &&
            legacyPartialHtml.includes(USER_STOPPED_RESPONSE_LABEL),
        'legacy partial stop records must preserve the old body and add the stop label'
    );

    const legacySentinelMessage = convertLegacyMessage({
        ...buildStoppedMessage(),
        id: 'legacy-sentinel-stopped-message',
        content: '⏹️ 已停止',
        agentResponseInterruption: undefined,
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'ui_status',
            userVisibleKind: 'status_notice',
            source: 'agent-run:cancelled-result'
        }
    });
    const legacySentinelHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, { message: legacySentinelMessage })
    );
    assert.strictEqual(
        legacySentinelMessage.blocks.length,
        0,
        'legacy stop sentinel body must be suppressed in favor of the structured terminal label'
    );
    assert(
        legacySentinelHtml.includes(USER_STOPPED_RESPONSE_LABEL) &&
            !legacySentinelHtml.includes('⏹'),
        'legacy sentinel must render one normalized stop label without duplicate stop copy'
    );

    const cacheMutationMessage = {
        ...buildStoppedMessage(),
        id: 'cache-mutation-message',
        agentResponseInterruption: undefined,
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'ui_status',
            userVisibleKind: 'status_notice',
            source: 'unrelated-status'
        }
    };
    const beforeStopMutation = convertLegacyMessage(cacheMutationMessage);
    assert.strictEqual(beforeStopMutation.metadata?.agentResponseInterruption, undefined);
    cacheMutationMessage.assistantReplyOrigin = {
        ...cacheMutationMessage.assistantReplyOrigin,
        source: 'agent-run:stop'
    };
    const afterStopMutation = convertLegacyMessage(cacheMutationMessage);
    assert.deepStrictEqual(
        afterStopMutation.metadata?.agentResponseInterruption,
        buildUserStoppedResponseInterruption(),
        'parser cache must invalidate when the same message object becomes a legacy stop record'
    );

    const stoppedAfterPartialAnswer = convertLegacyMessage(buildStoppedMessage({
        id: 'partial-stopped-message',
        content: '这是停止前已经生成的部分回答。',
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'model_authored',
            userVisibleKind: 'model_response',
            source: 'agent-stream:visible-content'
        }
    }));
    const partialHtml = renderToStaticMarkup(
        React.createElement(MessageRenderer, { message: stoppedAfterPartialAnswer })
    );
    assert(
        partialHtml.includes('这是停止前已经生成的部分回答。'),
        'partial model answer must remain visible after user stop'
    );
    assert(
        partialHtml.includes(USER_STOPPED_RESPONSE_LABEL),
        'partial model answer must carry the visible user-stop terminal state'
    );
}

function assertChatPanelLifecycleWiring() {
    const chatPanel = read('src/renderer/components/ChatPanel.tsx');
    const finalizerStart = chatPanel.indexOf('const finalizeAgentRunStopped = (');
    const finalizerEnd = chatPanel.indexOf('const markActiveAgentRunStopped = (', finalizerStart);
    const finalizerBlock = chatPanel.slice(finalizerStart, finalizerEnd);
    const cancelledResultMarker = chatPanel.indexOf('// 检查是否是用户取消（优先处理）');
    const cancelledResultStart = chatPanel.indexOf('if (resultWasCancelled) {', cancelledResultMarker);
    const cancelledResultEnd = chatPanel.indexOf('} else if (result.success)', cancelledResultStart);
    const cancelledResultBlock = chatPanel.slice(cancelledResultStart, cancelledResultEnd);
    const cancelledCatchStart = chatPanel.indexOf("if (error.message === '任务已取消'");
    const cancelledCatchEnd = chatPanel.indexOf("if (!canApplyRunUpdate())", cancelledCatchStart);
    const cancelledCatchBlock = chatPanel.slice(cancelledCatchStart, cancelledCatchEnd);

    assert(finalizerStart >= 0 && finalizerEnd > finalizerStart, 'ChatPanel must own one user-stop finalizer');
    assert(
        finalizerBlock.includes('agentResponseInterruption: interruption'),
        'stop finalizer must persist a structured, renderable terminal state'
    );
    assert(
        finalizerBlock.includes('didPresentTerminalState = updateMessageInConversation('),
        'partial response finalization must merge metadata without replacing model-authored content'
    );
    assert(
        !finalizerBlock.includes('updateLocalAssistantMessage('),
        'partial response finalization must not rewrite model origin as a UI status'
    );
    assert(
        finalizerBlock.includes("content: ''") &&
            finalizerBlock.includes('agentResponseInterruption: interruption'),
        'pre-token stop may have no assistant body only when a structured visible interruption is present'
    );
    assert(
        !chatPanel.includes("{ content: '', thinkingSteps: preservedSteps }"),
        'legacy renderless thinking-only stop message must be removed'
    );
    assert(
        chatPanel.includes("steps.filter((step) => step.status === 'success' || step.status === 'error')"),
        'stopped runs must not relabel pending or running steps as successful'
    );
    assert(
        chatPanel.includes('if (!resultWasCancelled) {') &&
            chatPanel.includes("updateStep(step.id, { status: 'success' })"),
        'normal completion may settle remaining steps only behind the non-cancelled guard'
    );
    assert(
        cancelledResultBlock.includes("finalizeAgentRunStopped(runId, 'agent-run:cancelled-result', {"),
        'cancelled results must use the shared stop finalizer'
    );
    assert(
        cancelledCatchBlock.includes("finalizeAgentRunStopped(runId, 'agent-run:cancelled-exception')"),
        'cancelled exceptions must use the shared stop finalizer'
    );
    assert(
        chatPanel.includes("finalizeAgentRunStopped(runId, 'agent-run:user-stopped')"),
        'stop-button path must use the shared stop finalizer'
    );
    const stopButtonStart = chatPanel.indexOf("console.log('[ChatPanel] 用户点击停止按钮')");
    const stopButtonEnd = chatPanel.indexOf('title="停止生成"', stopButtonStart);
    const stopButtonBlock = chatPanel.slice(stopButtonStart, stopButtonEnd);
    assert(
        stopButtonBlock.indexOf('stopGeneration();') <
            stopButtonBlock.indexOf('markActiveAgentRunStopped();'),
        'AbortController.abort must happen before stop-state persistence so a missing conversation cannot block cancellation'
    );
    assert(
        chatPanel.includes('.filter(shouldIncludeMessageInAgentConversationHistory)'),
        'interruption-only UI terminal messages must stay out of future model conversation history'
    );
    assert(
        finalizerBlock.includes('useAppStore.getState().saveCurrentProjectConversations();'),
        'successful stop finalization must bypass the ordinary debounced conversation save'
    );
}

function assertCancelledResultProjectionOrdering() {
    assert.strictEqual(decideAgentRunResultDisposition({
        isActiveRun: true,
        runCancelled: true,
        resultCancelled: true
    }), 'project_cancelled_result', 'the active cancelled result must remain readable after the button aborts');
    assert.strictEqual(decideAgentRunResultDisposition({
        isActiveRun: true,
        runCancelled: true,
        resultCancelled: false
    }), 'reject_result_after_stop', 'a non-cancelled result returned after stop must not update the UI');
    assert.strictEqual(decideAgentRunResultDisposition({
        isActiveRun: false,
        runCancelled: true,
        resultCancelled: true
    }), 'ignore_stale_result', 'a superseded run must not project even a well-formed cancelled result');
    assert.strictEqual(decideAgentRunResultDisposition({
        isActiveRun: true,
        runCancelled: false,
        resultCancelled: false
    }), 'process_active_result', 'the active non-cancelled result must keep the ordinary result path');

    const chatPanel = read('src/renderer/components/ChatPanel.tsx');
    const agentCall = chatPanel.indexOf('const result = await processWithUnifiedAgent(');
    const disposition = chatPanel.indexOf('const resultDisposition = decideAgentRunResultDisposition({', agentCall);
    const snapshotRead = chatPanel.indexOf('readRuntimeTaskSnapshot(runtimeResultData.runtimeTaskSnapshot)', agentCall);
    const cancelledFinalizer = chatPanel.indexOf("finalizeAgentRunStopped(runId, 'agent-run:cancelled-result', {", agentCall);
    assert(
        agentCall >= 0 && disposition > agentCall && snapshotRead > disposition && cancelledFinalizer > snapshotRead,
        'ChatPanel must admit the same-run cancelled result before reading and merging its bounded snapshot projection'
    );
}

function assertPersistenceAndRendererWiring() {
    const store = read('src/renderer/stores/app.store.ts');
    const parser = read('src/renderer/components/message/parser.ts');
    const renderer = read('src/renderer/components/message/MessageRenderer.tsx');
    const thinkingBlock = read('src/renderer/components/message/blocks/ThinkingBlock.tsx');
    const toolResultBlock = read('src/renderer/components/message/blocks/ToolResultBlock.tsx');
    const workbenchStyles = read('src/renderer/components/DesignAgentWorkbench.css');

    assert(
        store.includes('Boolean(message.agentResponseInterruption)'),
        'conversation persistence must retain interruption-only terminal messages'
    );
    assert(
        store.includes('resolveAgentResponseInterruption({'),
        'conversation persistence must normalize explicit and legacy interruption records'
    );
    assert(
        parser.includes('agentResponseInterruptionHash'),
        'parser cache must invalidate when a running response becomes user-stopped'
    );
    assert(
        renderer.includes('formatAgentResponseInterruption('),
        'MessageRenderer must render the shared interruption contract'
    );
    assert(
        renderer.includes('collapseForTerminalState={collapseProcessBlocks}'),
        'MessageRenderer must pass the shared terminal collapse state to process blocks'
    );
    assert(
        renderer.includes("const collapseProcessBlocks = message.role === 'assistant' && !isProcessActive") &&
        renderer.includes('getProcessBlockRenderKey(block.id, collapseProcessBlocks)') &&
            parser.includes('isExpanded: isStreaming') &&
            thinkingBlock.includes('collapseForTerminalState ? false') &&
            toolResultBlock.includes('collapseForTerminalState ? false'),
        'all live running-to-terminal transitions must remount process blocks into a collapsed presentation'
    );
    assert(
        /\.workbench-agent-panel \.multimodal-message\.assistant \.message-blocks\s*\{[\s\S]*?width:\s*100%;[\s\S]*?inline-size:\s*100%;/.test(workbenchStyles) &&
            /\.workbench-agent-panel \.multimodal-message\.assistant \.thinking-block,[\s\S]*?\.tool-result-block,[\s\S]*?\.card-block\s*\{[\s\S]*?width:\s*100%;[\s\S]*?inline-size:\s*100%;/.test(workbenchStyles),
        'workbench CSS must preserve non-zero full-width process and status-card blocks after compact bubble overrides'
    );
}

function main() {
    assertInterruptionContract();
    assertRenderableStoppedState();
    assertChatPanelLifecycleWiring();
    assertCancelledResultProjectionOrdering();
    assertPersistenceAndRendererWiring();

    console.log(JSON.stringify({
        success: true,
        checks: [
            'user-stop state is versioned and normalized',
            'pre-token stop renders a visible terminal label after parser filtering',
            'legacy persisted empty stop records are repaired during display',
            'legacy partial and sentinel stop records normalize without losing or duplicating content',
            'parser cache invalidates when an existing message becomes user-stopped',
            'partial model text is preserved with an in-message stop marker',
            'persisted thinking and failed tool-result details collapse in the user-stopped terminal state',
            'active process steps stay expanded while all ordinary terminal process groups collapse',
            'overlapping process steps use wall-clock span and untimed steps use the longest duration fallback',
            'legacy execution totals stay conserved without fabricating missing completion buckets',
            'workbench CSS preserves non-zero process-block width after compact bubble overrides',
            'button, cancelled result, and cancelled exception share one idempotent finalizer',
            'same-run cancelled results remain readable after abort while stale and non-cancelled late results stay blocked',
            'running steps are not relabelled as successful on cancellation',
            'interruption-only UI messages stay out of later model history',
            'successful stop finalization flushes persistence immediately'
        ]
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
}
