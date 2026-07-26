'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
    requiresAgentProtocolTransport,
    resolveAgentModelTransport
} = require(path.resolve(
    __dirname,
    '..',
    'src',
    'shared',
    'agent-model-transport-policy.ts'
));
const { ModelService } = require(path.resolve(
    __dirname,
    '..',
    'src',
    'main',
    'services',
    'model-service.ts'
));
const { AnthropicAdapter } = require(path.resolve(
    __dirname,
    '..',
    'src',
    'main',
    'services',
    'provider-adapters',
    'anthropic-adapter.ts'
));
const { GeminiAdapter } = require(path.resolve(
    __dirname,
    '..',
    'src',
    'main',
    'services',
    'provider-adapters',
    'gemini-adapter.ts'
));

function protocolHistory() {
    return [
        { role: 'system', content: 'system' },
        { role: 'user', content: '执行任务' },
        {
            role: 'assistant',
            content: '',
            reasoningContent: '先读取文档再判断。',
            toolCalls: [{ id: 'call_1', name: 'getDocumentInfo', arguments: {} }]
        },
        {
            role: 'tool_result',
            toolResults: [{ callId: 'call_1', success: true, output: { id: 7 } }]
        }
    ];
}

function runPolicyAssertions() {
    assert.strictEqual(
        resolveAgentModelTransport({
            messages: [{ role: 'user' }],
            toolCount: 0,
            hasProviderNativeTools: false
        }),
        'plain_chat',
        'clean no-tool history should keep the multimodal plain-chat path'
    );
    assert.strictEqual(
        resolveAgentModelTransport({
            messages: protocolHistory(),
            toolCount: 0,
            hasProviderNativeTools: false
        }),
        'provider_adapter',
        'tool protocol history must use provider-aware serialization even when this turn exposes no tools'
    );
    assert.strictEqual(
        requiresAgentProtocolTransport([{ role: 'assistant', reasoningContent: 'reasoning' }]),
        true,
        'reasoning protocol history must not enter plain chat'
    );
    assert.strictEqual(
        requiresAgentProtocolTransport([{ role: 'developer' }]),
        true,
        'unknown or newly introduced roles must fail closed into provider serialization'
    );
    assert.strictEqual(
        resolveAgentModelTransport({
            messages: [{ role: 'user' }],
            toolCount: 1,
            hasProviderNativeTools: false
        }),
        'provider_adapter',
        'current tool schemas require the provider adapter'
    );
    assert.strictEqual(
        resolveAgentModelTransport({
            messages: [{ role: 'user' }],
            toolCount: 0,
            hasProviderNativeTools: true
        }),
        'provider_adapter',
        'provider-native tools require the provider adapter'
    );
}

function runProviderEmptyToolShapeAssertions() {
    const anthropicRequest = new AnthropicAdapter().formatMessages(
        protocolHistory(),
        []
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(anthropicRequest, 'tools'),
        false,
        'Anthropic protocol history must not emit an empty tools array'
    );

    const geminiRequest = new GeminiAdapter().formatMessages(
        protocolHistory(),
        []
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(geminiRequest, 'tools'),
        false,
        'Gemini protocol history must not emit empty function declarations'
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(geminiRequest, 'toolConfig'),
        false,
        'Gemini must not enable function calling when this turn exposes no tools'
    );
}

async function runModelServiceRequestBodyAssertion() {
    const captured = [];
    const service = new ModelService({ xiaomiApiKey: 'test-key' });
    service.xiaomi = {
        chat: {
            completions: {
                create: async (request) => {
                    captured.push(request);
                    return {
                        choices: [{ message: { content: '已总结' }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 1, completion_tokens: 1 }
                    };
                }
            }
        }
    };

    await service.chatWithTools(
        'xiaomi-mimo-v2.5-pro',
        protocolHistory(),
        [],
        { thinkingEnabled: true }
    );

    assert.strictEqual(captured.length, 1, 'provider request should be issued exactly once');
    const request = captured[0];
    assert.deepStrictEqual(
        request.messages.map((message) => message.role),
        ['system', 'user', 'assistant', 'tool'],
        'internal tool_result must be serialized to the provider tool role'
    );
    assert.strictEqual(request.messages.some((message) => message.role === 'tool_result'), false);
    assert.strictEqual(
        request.messages.find((message) => message.role === 'assistant')?.reasoning_content,
        '先读取文档再判断。',
        'thinking-enabled finalization must preserve provider reasoning history'
    );
    assert.strictEqual(Object.prototype.hasOwnProperty.call(request, 'tools'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(request, 'tool_choice'), false);

    const agentSource = fs.readFileSync(path.resolve(
        __dirname,
        '..',
        'src',
        'renderer',
        'services',
        'agent-runtime',
        'agent.ts'
    ), 'utf8');
    const forcedFinalStart = agentSource.indexOf('private async requestForcedFinalResponse');
    const forcedFinalEnd = agentSource.indexOf('private async buildForcedFinalResponseFallbackResult', forcedFinalStart);
    const forcedFinalSource = agentSource.slice(forcedFinalStart, forcedFinalEnd);
    assert(forcedFinalSource.includes('thinkingEnabled: this.config.thinkingEnabled'),
        'forced final summary must preserve the run thinking protocol preference');
}

async function main() {
    runPolicyAssertions();
    runProviderEmptyToolShapeAssertions();
    await runModelServiceRequestBodyAssertion();
    console.log(JSON.stringify({
        ok: true,
        checked: [
            'plain-chat-clean-history',
            'tool-protocol-history-routing',
            'reasoning-protocol-routing',
            'unknown-role-fail-closed',
            'provider-tool-role-serialization',
            'provider-reasoning-history-serialization',
            'openai-compatible-empty-tool-request-shape',
            'anthropic-empty-tool-request-shape',
            'gemini-empty-tool-request-shape',
            'single-provider-request-no-retry'
        ]
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
