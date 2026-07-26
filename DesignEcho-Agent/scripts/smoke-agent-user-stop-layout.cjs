#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

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
    buildUserStoppedResponseInterruption
} = require(path.join(ROOT, 'src/shared/agent-response-interruption.ts'));
const {
    convertLegacyMessage
} = require(path.join(ROOT, 'src/renderer/components/message/parser.ts'));
const {
    MessageRenderer
} = require(path.join(ROOT, 'src/renderer/components/message/MessageRenderer.tsx'));

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function buildLayoutFixture() {
    const longReasoning = [
        '停止前 Agent 已经读取项目资源并形成一段较长的过程说明。',
        '这些数据需要保留用于运行审计，但终态默认不能继续展开。',
        '停止标记必须紧邻紧凑的过程摘要显示。'
    ].join('\n\n').repeat(40);

    return convertLegacyMessage({
        id: 'user-stop-layout-fixture',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isThinking: false,
        thinkingSteps: [
            {
                id: 'reasoning-1',
                type: 'thinking',
                content: longReasoning,
                status: 'success',
                timestamp: Date.now()
            },
            {
                id: 'tool-result-1',
                type: 'tool_result',
                content: '项目资源读取完成',
                toolName: 'listProjectResources',
                toolResult: {
                    success: true,
                    totalFiles: 44
                },
                status: 'success',
                timestamp: Date.now()
            },
            {
                id: 'reasoning-2',
                type: 'thinking',
                content: longReasoning,
                status: 'success',
                timestamp: Date.now()
            }
        ],
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'ui_status',
            userVisibleKind: 'status_notice',
            source: 'agent-run:stop'
        },
        agentResponseInterruption: buildUserStoppedResponseInterruption()
    });
}

function buildScreenshotEquivalentProcessFixture(isThinking) {
    const processStartedAt = Date.now();
    const thinkingSteps = Array.from({ length: 30 }, (_, index) => ({
        id: `screenshot-process-step-${index + 1}`,
        type: index % 3 === 0 ? 'tool_call' : 'decision',
        content: `第 ${index + 1} 项真实判断与处理内容`,
        toolName: index % 3 === 0 ? 'getDocumentInfo' : undefined,
        status: index >= 24 ? 'error' : 'success',
        duration: index === 29 ? 16171 : 16140,
        timestamp: processStartedAt + index
    }));

    return convertLegacyMessage({
        id: 'screenshot-terminal-process-layout-fixture',
        role: 'assistant',
        content: '⚠️ 这次还没有完成。当前还缺少关键信息；本轮不会改动画面。',
        timestamp: Date.now(),
        isThinking,
        thinkingSteps,
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
}

async function buildDynamicTransitionBundle(states) {
    const result = await esbuild.build({
        stdin: {
            contents: `
                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import { MessageRenderer } from './src/renderer/components/message/MessageRenderer.tsx';

                const states = ${JSON.stringify(states)};
                const root = createRoot(document.getElementById('dynamic-root'));

                window.__renderProcessLifecycle = function renderProcessLifecycle(state) {
                    const entry = states[state];
                    root.render(React.createElement(MessageRenderer, {
                        message: entry.message,
                        isStreaming: entry.isStreaming
                    }));
                };
            `,
            resolveDir: ROOT,
            sourcefile: 'process-dynamic-transition-fixture.js'
        },
        bundle: true,
        define: {
            'process.env.NODE_ENV': '"production"'
        },
        format: 'iife',
        outfile: path.join(ROOT, 'tmp', 'process-dynamic-transition-fixture.js'),
        platform: 'browser',
        plugins: [{
            name: 'ignore-component-css',
            setup(build) {
                build.onLoad({ filter: /\.css$/ }, () => ({
                    contents: '',
                    loader: 'css'
                }));
            }
        }],
        target: 'chrome120',
        write: false
    });
    const script = result.outputFiles.find((file) => file.path.endsWith('.js'));
    assert(script, 'dynamic React transition bundle must include JavaScript output');
    return script.text;
}

async function main() {
    const rendererStyles = read('src/renderer/components/message/MessageRenderer.css');
    const workbenchStyles = read('src/renderer/components/DesignAgentWorkbench.css');
    const message = buildLayoutFixture();
    const activeMessage = {
        ...message,
        isStreaming: true,
        blocks: message.blocks.map((block) => (
            block.type === 'thinking'
                ? { ...block, isExpanded: true }
                : block
        )),
        metadata: {
            ...message.metadata,
            agentResponseInterruption: undefined
        }
    };
    const genericActiveMessage = buildScreenshotEquivalentProcessFixture(true);
    const genericTerminalMessage = buildScreenshotEquivalentProcessFixture(false);
    const directResponseMessage = convertLegacyMessage({
        id: 'direct-response-layout-fixture',
        role: 'assistant',
        content: '可以，我们直接进入正题。',
        timestamp: Date.now(),
        isThinking: false,
        assistantReplyOrigin: {
            version: 'assistant-reply-origin/v0',
            origin: 'model_authored',
            userVisibleKind: 'model_response',
            source: 'conversational:chat'
        }
    });
    const dynamicTransitionBundle = await buildDynamicTransitionBundle({
        'user-stop-active': {
            message: activeMessage,
            isStreaming: true
        },
        'user-stop-terminal': {
            message,
            isStreaming: false
        },
        'generic-active': {
            message: genericActiveMessage,
            isStreaming: true
        },
        'generic-terminal': {
            message: genericTerminalMessage,
            isStreaming: false
        },
        'direct-response': {
            message: directResponseMessage,
            isStreaming: false
        }
    });
    const markup = renderToStaticMarkup(
        React.createElement(MessageRenderer, { message })
    );

    const browser = await chromium.launch({
        channel: 'chrome',
        headless: true
    });
    try {
        const page = await browser.newPage({
            viewport: {
                width: 420,
                height: 900
            }
        });
        await page.setContent(
            `<main class="workbench-agent-panel"><div class="message-wrapper">${markup}</div></main>`
        );
        await page.addStyleTag({
            content: `
                :root {
                    --de-bg: #0b0d10;
                    --de-text: #f5f7fa;
                    --de-text-secondary: #8d939e;
                    --de-border: rgba(255, 255, 255, 0.12);
                    --de-error: #ef4444;
                }
                html, body {
                    margin: 0;
                    background: var(--de-bg);
                }
                .workbench-agent-panel {
                    width: 340px;
                    padding: 20px;
                }
            `
        });
        await page.addStyleTag({ content: rendererStyles });
        await page.addStyleTag({ content: workbenchStyles });
        await page.addStyleTag({
            content: `
                *, *::before, *::after {
                    animation: none !important;
                    transition: none !important;
                }
            `
        });

        const metrics = await page.evaluate(() => {
            function rect(selector) {
                const element = document.querySelector(selector);
                if (!element) {
                    throw new Error(`missing layout element: ${selector}`);
                }
                const box = element.getBoundingClientRect();
                return {
                    top: box.top,
                    right: box.right,
                    bottom: box.bottom,
                    left: box.left,
                    width: box.width,
                    height: box.height
                };
            }

            const messageBody = rect('.message-body');
            const messageBlocks = rect('.message-blocks');
            const thinkingBlock = rect('.thinking-block');
            const interruption = rect('.agent-response-interruption');
            const wholeMessage = rect('.multimodal-message');
            const processBlocks = Array.from(
                document.querySelectorAll('.message-blocks > .message-block')
            ).map((element) => {
                const box = element.getBoundingClientRect();
                return {
                    top: box.top,
                    bottom: box.bottom,
                    width: box.width,
                    height: box.height
                };
            });
            const processBottom = processBlocks.reduce(
                (maximum, block) => Math.max(maximum, block.bottom),
                messageBlocks.top
            );

            return {
                messageBody,
                messageBlocks,
                thinkingBlock,
                interruption,
                wholeMessage,
                processBlocks,
                processDetailsCount: document.querySelectorAll('.thinking-steps').length,
                stopLabel: document.querySelector('.agent-response-interruption')?.textContent?.trim() || '',
                interruptionGap: interruption.top - processBottom
            };
        });

        assert(
            metrics.messageBlocks.width >= metrics.messageBody.width * 0.8,
            `message blocks collapsed to an invalid width: ${JSON.stringify(metrics)}`
        );
        assert(
            metrics.thinkingBlock.width >= metrics.messageBody.width * 0.8,
            `thinking block collapsed to an invalid width: ${JSON.stringify(metrics)}`
        );
        assert.strictEqual(
            metrics.processDetailsCount,
            0,
            'user-stopped process details must start collapsed'
        );
        assert(
            metrics.interruptionGap >= 0 && metrics.interruptionGap <= 16,
            `stop label must stay adjacent to the compact process summary: ${JSON.stringify(metrics)}`
        );
        assert(
            metrics.wholeMessage.height < 220,
            `stopped terminal message must not create an abnormal vertical gap: ${JSON.stringify(metrics)}`
        );
        assert.strictEqual(metrics.stopLabel, '你已停止此响应');

        const outputDir = path.join(ROOT, 'output', 'playwright');
        fs.mkdirSync(outputDir, { recursive: true });
        const screenshotPath = path.join(outputDir, 'user-stop-terminal-layout.png');
        await page.screenshot({
            path: screenshotPath,
            fullPage: true
        });

        await page.evaluate(() => {
            document.body.innerHTML = `
                <main class="workbench-agent-panel">
                    <div class="message-wrapper">
                        <div id="dynamic-root"></div>
                    </div>
                </main>
            `;
        });
        await page.addScriptTag({ content: dynamicTransitionBundle });
        await page.evaluate(() => {
            window.__renderProcessLifecycle('user-stop-active');
        });
        await page.waitForFunction(() => (
            document.querySelectorAll('#dynamic-root .thinking-steps').length > 0
        ));
        const activeDetailsCount = await page.locator('#dynamic-root .thinking-steps').count();

        await page.evaluate(() => {
            window.__renderProcessLifecycle('user-stop-terminal');
        });
        await page.waitForFunction(() => (
            document.querySelector('#dynamic-root .agent-response-interruption') &&
            document.querySelectorAll('#dynamic-root .thinking-steps').length === 0
        ));
        const terminalTransition = await page.evaluate(() => {
            const messageElement = document.querySelector('#dynamic-root .multimodal-message');
            if (!messageElement) {
                throw new Error('missing dynamically updated terminal message');
            }
            return {
                detailsCount: document.querySelectorAll('#dynamic-root .thinking-steps').length,
                height: messageElement.getBoundingClientRect().height,
                stopLabel: document.querySelector(
                    '#dynamic-root .agent-response-interruption'
                )?.textContent?.trim() || ''
            };
        });
        assert(
            activeDetailsCount > 0,
            'running process fixture must begin expanded before the terminal update'
        );
        assert.strictEqual(
            terminalTransition.detailsCount,
            0,
            'adding interruption metadata must synchronously remount process blocks collapsed'
        );
        assert.strictEqual(terminalTransition.stopLabel, '你已停止此响应');
        assert(
            terminalTransition.height < 220,
            `dynamic terminal update must remain compact: ${JSON.stringify(terminalTransition)}`
        );

        await page.locator('#dynamic-root .thinking-header').click();
        await page.waitForFunction(() => (
            document.querySelectorAll('#dynamic-root .thinking-steps').length > 0
        ));
        const manualExpandedDetailsCount = await page.locator(
            '#dynamic-root .thinking-steps'
        ).count();
        assert(
            manualExpandedDetailsCount > 0,
            'retained audit details must remain manually expandable after user stop'
        );

        await page.evaluate(() => {
            window.__renderProcessLifecycle('generic-active');
        });
        await page.waitForFunction(() => (
            document.querySelectorAll('#dynamic-root .thinking-steps').length > 0
        ));
        const genericActiveStepCount = await page.locator(
            '#dynamic-root .thinking-step'
        ).count();

        await page.evaluate(() => {
            window.__renderProcessLifecycle('generic-terminal');
        });
        await page.waitForFunction(() => (
            document.querySelector('#dynamic-root .thinking-header') &&
            document.querySelectorAll('#dynamic-root .thinking-steps').length === 0
        ));
        const genericTerminalTransition = await page.evaluate(() => {
            const messageElement = document.querySelector('#dynamic-root .multimodal-message');
            if (!messageElement) {
                throw new Error('missing dynamically updated generic terminal message');
            }
            function measure(selector) {
                const element = document.querySelector(`#dynamic-root ${selector}`);
                if (!element) return null;
                const box = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                return {
                    className: element.className,
                    width: box.width,
                    height: box.height,
                    display: style.display,
                    flex: style.flex,
                    inlineSize: style.inlineSize,
                    minInlineSize: style.minInlineSize,
                    maxInlineSize: style.maxInlineSize
                };
            }
            return {
                detailsCount: document.querySelectorAll('#dynamic-root .thinking-steps').length,
                height: messageElement.getBoundingClientRect().height,
                summary: document.querySelector('#dynamic-root .thinking-header')?.textContent?.replace(/\s+/g, ' ').trim() || '',
                interruptionCount: document.querySelectorAll('#dynamic-root .agent-response-interruption').length,
                message: measure('.multimodal-message'),
                body: measure('.message-body'),
                blocks: measure('.message-blocks'),
                thinking: measure('.thinking-block'),
                contentBlock: measure('.message-blocks > :not(.thinking-block)')
            };
        });
        assert.strictEqual(genericActiveStepCount, 30);
        assert.strictEqual(
            genericTerminalTransition.detailsCount,
            0,
            'ordinary running-to-terminal updates must synchronously collapse process details'
        );
        assert(
            genericTerminalTransition.summary.includes('判断与处理') &&
                genericTerminalTransition.summary.includes('(30)') &&
                genericTerminalTransition.summary.includes('16.2s'),
            `terminal summary must retain count and duration: ${JSON.stringify(genericTerminalTransition)}`
        );
        assert.strictEqual(genericTerminalTransition.interruptionCount, 0);
        assert(
            genericTerminalTransition.contentBlock &&
                genericTerminalTransition.contentBlock.width >= genericTerminalTransition.body.width * 0.8,
            `terminal result card must keep a readable width: ${JSON.stringify(genericTerminalTransition)}`
        );
        assert(
            genericTerminalTransition.height < 320,
            `ordinary terminal process must not leave a long vertical rail: ${JSON.stringify(genericTerminalTransition)}`
        );

        const genericTerminalScreenshotPath = path.join(
            outputDir,
            'agent-terminal-process-compact-layout.png'
        );
        await page.screenshot({
            path: genericTerminalScreenshotPath,
            fullPage: true
        });

        await page.locator('#dynamic-root .thinking-header').click();
        await page.waitForFunction(() => (
            document.querySelectorAll('#dynamic-root .thinking-step').length === 30
        ));
        const genericManualExpandedStepCount = await page.locator(
            '#dynamic-root .thinking-step'
        ).count();
        const genericManualExpandedMetrics = await page.evaluate(() => {
            const body = document.querySelector('#dynamic-root .message-body')?.getBoundingClientRect();
            const steps = document.querySelector('#dynamic-root .thinking-steps')?.getBoundingClientRect();
            const firstStepText = document.querySelector('#dynamic-root .thinking-step .step-text');
            const firstStepTextBox = firstStepText?.getBoundingClientRect();
            return {
                bodyWidth: body?.width || 0,
                stepsWidth: steps?.width || 0,
                firstStepTextWidth: firstStepTextBox?.width || 0,
                firstStepText: firstStepText?.textContent?.trim() || ''
            };
        });
        assert.strictEqual(
            genericManualExpandedStepCount,
            30,
            'ordinary terminal audit details must remain manually expandable'
        );
        assert(
            genericManualExpandedMetrics.stepsWidth >= genericManualExpandedMetrics.bodyWidth * 0.8 &&
                genericManualExpandedMetrics.firstStepTextWidth >= 120 &&
                genericManualExpandedMetrics.firstStepText.length > 0,
            `manually expanded audit details must remain readable instead of collapsing to an empty rail: ${JSON.stringify(genericManualExpandedMetrics)}`
        );

        await page.evaluate(() => {
            window.__renderProcessLifecycle('direct-response');
        });
        await page.waitForFunction(() => (
            document.querySelector('#dynamic-root .text-block') &&
            !document.querySelector('#dynamic-root .thinking-header')
        ));
        const directResponseMetrics = await page.evaluate(() => {
            const messageElement = document.querySelector('#dynamic-root .multimodal-message');
            const body = document.querySelector('#dynamic-root .message-body')?.getBoundingClientRect();
            const text = document.querySelector('#dynamic-root .text-block')?.getBoundingClientRect();
            return {
                messageHeight: messageElement?.getBoundingClientRect().height || 0,
                bodyWidth: body?.width || 0,
                textWidth: text?.width || 0,
                text: document.querySelector('#dynamic-root .text-block')?.textContent?.trim() || '',
                processHeaderCount: document.querySelectorAll('#dynamic-root .thinking-header').length
            };
        });
        assert(
            directResponseMetrics.textWidth >= 100 &&
                directResponseMetrics.textWidth <= directResponseMetrics.bodyWidth &&
                directResponseMetrics.messageHeight < 120 &&
                directResponseMetrics.processHeaderCount === 0,
            `ordinary replies without process steps must keep a compact readable bubble: ${JSON.stringify(directResponseMetrics)}`
        );

        console.log(JSON.stringify({
            success: true,
            metrics,
            dynamicTransition: {
                activeDetailsCount,
                terminalDetailsCount: terminalTransition.detailsCount,
                terminalHeight: terminalTransition.height,
                manualExpandedDetailsCount
            },
            genericDynamicTransition: {
                activeStepCount: genericActiveStepCount,
                terminalDetailsCount: genericTerminalTransition.detailsCount,
                terminalHeight: genericTerminalTransition.height,
                terminalSummary: genericTerminalTransition.summary,
                manualExpandedStepCount: genericManualExpandedStepCount,
                manualExpandedMetrics: genericManualExpandedMetrics,
                screenshotPath: genericTerminalScreenshotPath
            },
            directResponseMetrics,
            screenshotPath
        }, null, 2));
    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
